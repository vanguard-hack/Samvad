import { supabase } from "@/lib/supabase"

/**
 * One conversation: an opening of the voice assistant (Ctrl+Space until
 * closed), or a New patient voice intake (saved with the patient, on consent).
 */
export interface AssistantSession {
  id: string
  kind: "assistant" | "intake"
  patient_id: string | null
  title: string | null
  started_at: string
  ended_at: string | null
  message_count: number
}

export interface AssistantMessage {
  id: number
  /** Intake: "user" = the patient, "assistant" = Samvad asking. */
  role: "user" | "assistant"
  /** Verbatim, in the speaker's language. */
  text: string
  english: string | null
  /** Clip in the private patient-audio bucket (intake only). */
  audio_path: string | null
  language: string | null
  interrupted: boolean
  created_at: string
}

/** Fired after a turn is saved, so an open Conversations page can refresh. */
export const LOG_EVENT = "samvad:assistant-log"

function db() {
  if (!supabase) throw new Error("Supabase is not configured")
  return supabase
}

export async function listSessions(): Promise<AssistantSession[]> {
  const { data, error } = await db()
    .from("assistant_sessions")
    .select("id, kind, patient_id, title, started_at, ended_at, assistant_messages(count)")
    .order("started_at", { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((s) => ({
    id: s.id,
    kind: s.kind ?? "assistant",
    patient_id: s.patient_id ?? null,
    title: s.title,
    started_at: s.started_at,
    ended_at: s.ended_at,
    message_count: (s.assistant_messages as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
}

export async function listMessages(sessionId: string): Promise<AssistantMessage[]> {
  const { data, error } = await db()
    .from("assistant_messages")
    .select("id, role, text, english, audio_path, language, interrupted, created_at")
    .eq("session_id", sessionId)
    .order("id")
  if (error) throw error
  return data as AssistantMessage[]
}

/**
 * Records one assistant session. The session row is created with the first
 * question (no empty sessions), writes are kept in order, and a failed write
 * never interrupts the conversation itself.
 */
export class ConversationRecorder {
  private sessionId: Promise<string | null> | null = null
  private chain: Promise<unknown> = Promise.resolve()

  private session(firstText: string) {
    this.sessionId ??= (async () => {
      const { data, error } = await db()
        .from("assistant_sessions")
        .insert({ title: firstText.slice(0, 120) })
        .select("id")
        .single()
      return error ? null : (data.id as string)
    })()
    return this.sessionId
  }

  add(role: "user" | "assistant", text: string, language: string | null, interrupted = false) {
    const clean = text.trim().slice(0, 4000)
    if (!clean) return
    this.chain = this.chain
      .then(async () => {
        const id = await this.session(clean)
        if (!id) return
        await db().from("assistant_messages").insert({ session_id: id, role, text: clean, language, interrupted })
        window.dispatchEvent(new CustomEvent(LOG_EVENT, { detail: { sessionId: id } }))
      })
      .catch(() => {})
  }

  end() {
    const started = this.sessionId
    if (!started) return
    this.chain = this.chain
      .then(async () => {
        const id = await started
        if (!id) return
        await db().from("assistant_sessions").update({ ended_at: new Date().toISOString() }).eq("id", id)
        window.dispatchEvent(new CustomEvent(LOG_EVENT, { detail: { sessionId: id } }))
      })
      .catch(() => {})
  }
}

/** One spoken turn of a voice intake, as stored with the patient. */
export interface IntakeChatTurn {
  role: "samvad" | "patient"
  text: string
  english?: string
  at: number
  audio_path?: string | null
}

/**
 * Adds a finished voice intake to the conversation history. Call only after the
 * patient was saved WITH consent (Critical Rule 3); the session is deleted with
 * the patient.
 */
export async function saveIntakeConversation(
  patient: { id: string; full_name: string },
  language: string,
  turns: IntakeChatTurn[],
): Promise<void> {
  const spoken = turns.filter((t) => t.text.trim())
  if (!spoken.length) return
  const iso = (ms: number) => new Date(ms).toISOString()
  const { data, error } = await db()
    .from("assistant_sessions")
    .insert({
      kind: "intake",
      patient_id: patient.id,
      title: patient.full_name.slice(0, 120),
      started_at: iso(spoken[0].at),
      ended_at: iso(spoken[spoken.length - 1].at),
    })
    .select("id")
    .single()
  if (error) throw error
  const { error: msgError } = await db()
    .from("assistant_messages")
    .insert(
      spoken.map((t) => ({
        session_id: data.id,
        role: t.role === "patient" ? "user" : "assistant",
        text: t.text.trim().slice(0, 4000),
        english: t.english && t.english !== t.text ? t.english.slice(0, 4000) : null,
        audio_path: t.audio_path ?? null,
        language,
        created_at: iso(t.at),
      })),
    )
  if (msgError) throw msgError
  window.dispatchEvent(new CustomEvent(LOG_EVENT, { detail: { sessionId: data.id } }))
}

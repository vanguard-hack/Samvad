import { supabase } from "@/lib/supabase"

/** One opening of the voice assistant (Ctrl+Space until closed). */
export interface AssistantSession {
  id: string
  title: string | null
  started_at: string
  ended_at: string | null
  message_count: number
}

export interface AssistantMessage {
  id: number
  role: "user" | "assistant"
  text: string
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
    .select("id, title, started_at, ended_at, assistant_messages(count)")
    .order("started_at", { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    started_at: s.started_at,
    ended_at: s.ended_at,
    message_count: (s.assistant_messages as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
}

export async function listMessages(sessionId: string): Promise<AssistantMessage[]> {
  const { data, error } = await db()
    .from("assistant_messages")
    .select("id, role, text, language, interrupted, created_at")
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

import { type Sex } from "@/data/sample"
import { supabase } from "@/lib/supabase"
import { type IntakeTurn } from "./use-voice-intake"

export const QUEUE_STATUSES = ["needs_action", "in_progress", "waiting", "completed"] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]
export const PRIORITIES = ["high", "medium", "low"] as const
/** Set by the doctor, never by AI. null = not triaged yet. */
export type Priority = (typeof PRIORITIES)[number]
export type LastEvent = "registered" | "voice_intake" | "triaged" | "status_changed" | "visit" | "assistant"

/** A row of public.patients (see supabase/migrations/). */
export interface PatientRow {
  id: string
  patient_number: number
  full_name: string
  age: number
  sex: Sex
  phone: string | null
  language: string
  can_read: boolean
  companion: boolean
  allergies: string | null
  conditions: string[]
  medicines: string | null
  consent: "given" | "declined"
  patient_words: Record<string, string>
  intake_log: IntakeLogEntry[]
  clinic: string | null
  reason: string | null
  priority: Priority | null
  queue_status: QueueStatus
  last_event: LastEvent
  last_event_at: string
  due_at: string | null
  visits: number
  last_visit: string
  created_at: string
}

/** One stored turn of the voice intake; audio lives in the private "patient-audio" bucket. */
export interface IntakeLogEntry {
  seq: number
  role: "samvad" | "patient"
  field: string
  text: string
  english?: string
  audio_path: string | null
}

export const AUDIO_BUCKET = "patient-audio"

export type NewPatient = Pick<
  PatientRow,
  "full_name" | "age" | "sex" | "phone" | "language" | "can_read" | "companion" | "allergies" | "conditions" | "medicines" | "patient_words"
>

/** Fields the doctor edits from the queue (status, triage). */
export type QueuePatch = Partial<Pick<PatientRow, "clinic" | "reason" | "priority" | "queue_status" | "due_at">>

const COLUMNS =
  "id, patient_number, full_name, age, sex, phone, language, can_read, companion, allergies, conditions, medicines, consent, patient_words, intake_log, clinic, reason, priority, queue_status, last_event, last_event_at, due_at, visits, last_visit, created_at"

export const patientCode = (n: number) => `SMV-${n}`

/** Phone shown masked, as everywhere else in the doctor UI. */
export function maskPhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10)
  return digits ? `+91 ••••• ••${digits.slice(-3)}` : "—"
}

/** Which event a queue edit records. */
export function eventFor(patch: QueuePatch): LastEvent {
  return "queue_status" in patch && Object.keys(patch).length === 1 ? "status_changed" : "triaged"
}

function client() {
  if (!supabase) throw new Error("Supabase is not configured")
  return supabase
}

export async function listPatients(): Promise<PatientRow[]> {
  const { data, error } = await client().from("patients").select(COLUMNS).order("created_at", { ascending: false })
  if (error) throw error
  return data as PatientRow[]
}

export async function getPatient(id: string): Promise<PatientRow | null> {
  const { data, error } = await client().from("patients").select(COLUMNS).eq("id", id).maybeSingle()
  if (error) throw error
  return data as PatientRow | null
}

/** Updates queue fields and records the change as the patient's last event. */
export async function updatePatientQueue(id: string, patch: QueuePatch): Promise<PatientRow> {
  const { data, error } = await client()
    .from("patients")
    .update({ ...patch, last_event: eventFor(patch), last_event_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as PatientRow
}

/** Marks a record as saved by the voice assistant (audit trail for the Rule 1 override). */
export async function markSavedByAssistant(patient: PatientRow): Promise<void> {
  const at = new Date().toISOString()
  const { error } = await client().from("patients").update({ last_event: "assistant", last_event_at: at }).eq("id", patient.id)
  if (error) throw error
  patient.last_event = "assistant"
  patient.last_event_at = at
}

/** Saves a consented patient. Called only after the doctor presses "Add patient" (Critical Rule 1). */
export async function createPatient(p: NewPatient): Promise<PatientRow> {
  const { data, error } = await client()
    .from("patients")
    .insert({ ...p, consent: "given" })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as PatientRow
}

/**
 * Uploads the voice-intake conversation (questions + patient answers) for a
 * consented patient and records it on the patient row. Files go under
 * <doctor id>/<patient id>/ so storage policies keep them private to the doctor.
 * Returns how many audio files failed to upload (their text is still kept).
 */
export async function saveIntakeRecording(patient: PatientRow, turns: IntakeTurn[]): Promise<number> {
  if (!turns.length) return 0
  const db = client()
  const { data } = await db.auth.getSession()
  const doctorId = data.session?.user.id
  if (!doctorId) throw new Error("Not signed in")

  let failed = 0
  const log: IntakeLogEntry[] = await Promise.all(
    turns.map(async (turn, i) => {
      const seq = i + 1
      const path = `${doctorId}/${patient.id}/${String(seq).padStart(3, "0")}-${turn.role}-${turn.field.replace(/[^a-z.]/gi, "")}.wav`
      const { error } = await db.storage.from(AUDIO_BUCKET).upload(path, turn.audio, { contentType: "audio/wav", upsert: false })
      if (error) failed++
      return { seq, role: turn.role, field: turn.field, text: turn.text, english: turn.english, audio_path: error ? null : path }
    }),
  )
  const { error } = await db
    .from("patients")
    .update({ intake_log: log, last_event: "voice_intake", last_event_at: new Date().toISOString() })
    .eq("id", patient.id)
  if (error) throw error
  patient.intake_log = log
  patient.last_event = "voice_intake"
  return failed
}

/** Short-lived links for playing the stored intake audio. */
export async function intakeAudioUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await client().storage.from(AUDIO_BUCKET).createSignedUrls(paths, 60 * 30)
  if (error) throw error
  const urls: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl
  return urls
}

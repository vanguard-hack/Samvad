import { type PatientStatus, type SamplePatient, type Sex } from "@/data/sample"
import { supabase } from "@/lib/supabase"
import { type IntakeTurn } from "./use-voice-intake"

/** A row of public.patients (see supabase/migrations/*_create_patients.sql). */
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
  status: PatientStatus
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

const COLUMNS =
  "id, patient_number, full_name, age, sex, phone, language, can_read, companion, allergies, conditions, medicines, consent, patient_words, intake_log, status, visits, last_visit, created_at"

export const patientCode = (n: number) => `SMV-${n}`

/** Phone shown masked, as everywhere else in the doctor UI. */
export function maskPhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10)
  return digits ? `+91 ••••• ••${digits.slice(-3)}` : "—"
}

/** Shape used by the patients table. `ref` is the route id (the row uuid). */
export function toTableRow(p: PatientRow): SamplePatient {
  return {
    id: patientCode(p.patient_number),
    ref: p.id,
    name: p.full_name,
    age: p.age,
    sex: p.sex,
    phone: maskPhone(p.phone),
    language: p.language,
    lastVisit: p.last_visit,
    visits: p.visits,
    status: p.status,
  }
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
  const { error } = await db.from("patients").update({ intake_log: log }).eq("id", patient.id)
  if (error) throw error
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

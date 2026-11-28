import { type PatientRow } from "./patients-api"

/**
 * Patients who DECLINED recording consent: kept in this browser tab's memory
 * only, never written to the database, and gone on reload (Critical Rule 3).
 */
const store = new Map<string, PatientRow>()

export function addSessionPatient(p: Omit<PatientRow, "id" | "patient_number" | "consent" | "intake_log">): PatientRow {
  const row = { ...p, id: `session-${crypto.randomUUID()}`, patient_number: 0, consent: "declined" as const, intake_log: [] }
  store.set(row.id, row)
  return row
}

export const getSessionPatient = (id: string) => store.get(id) ?? null
export const listSessionPatients = () => [...store.values()].reverse()

import type { Department, SampleAppointment } from "@/data/appointments"
import { api } from "@/lib/api"

/** GET /api/doctors (backend/app/schemas/appointments.py: DoctorsOut). */
export interface DoctorSlot {
  id: string
  name: string
  department: Department
  available: boolean
  recommended: boolean
}

export interface DoctorsOut {
  doctors: DoctorSlot[]
  recommendedDepartment: Department | null
}

/** A slot on one day: yyyy-mm-dd and HH:mm (24-hour), in the clinic's time zone. */
export interface Slot {
  date: string
  start: string
  end: string
}

/** What is chosen so far when booking (carried to the Patients page and back for a new patient). */
export interface BookingDraft {
  date: string
  start: string
  patientId?: string
}

/** Doctors for a slot, each marked free or busy; with a patient, their department's doctors are recommended. */
export async function listDoctors(slot: Slot, patientId: string | null, signal?: AbortSignal): Promise<DoctorsOut> {
  const params = new URLSearchParams({ date: slot.date, start: slot.start, end: slot.end })
  if (patientId) params.set("patientId", patientId)
  const res = await api(`/doctors?${params}`, { signal })
  return (await res.json()) as DoctorsOut
}

/** Books the consultation; the backend adds a Google Meet link and emails the invite to the signed-in user. */
export async function bookAppointment(
  booking: Slot & { patientId: string; doctorId: string; notes?: string },
): Promise<SampleAppointment> {
  const res = await api("/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  })
  return (await res.json()) as SampleAppointment
}

/** "HH:mm" → minutes since midnight (NaN for an empty or partly typed time). */
export function toMinutes(hm: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hm)
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN
}

/** "HH:mm" plus minutes, as "HH:mm", kept within the same day (at most 23:59). */
export function addMinutes(hm: string, minutes: number) {
  const total = Math.min(toMinutes(hm) + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

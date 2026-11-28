/**
 * The doctor's appointments, shared by the Consultations calendar, the Samvad
 * Assistant chat and the voice assistant, so a status changed in one shows in
 * the others. Sample data held in memory only: changes vanish on reload (no
 * backend for appointments yet).
 */
import { useSyncExternalStore } from "react"

import { SAMPLE_APPOINTMENTS, findDoctor, type AppointmentStatus, type SampleAppointment } from "@/data/appointments"
import { findPatient } from "@/data/sample"

let appointments: SampleAppointment[] = SAMPLE_APPOINTMENTS
const listeners = new Set<() => void>()

export function getAppointments() {
  return appointments
}

export function setAppointmentStatus(id: string, status: AppointmentStatus) {
  appointments = appointments.map((a) => (a.id === id ? { ...a, status } : a))
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppointments() {
  return useSyncExternalStore(subscribe, getAppointments)
}

/** The calendar as the voice assistant reads it: one line of facts per appointment. */
export function calendarDigest() {
  return appointments.map((a) => {
    const doctor = findDoctor(a.doctorId)
    return {
      id: a.id,
      date: a.date,
      start: a.start,
      end: a.end,
      patient: findPatient(a.patientId)?.name ?? a.patientId,
      patient_id: a.patientId,
      doctor: doctor?.name ?? a.doctorId,
      department: doctor?.department ?? "",
      status: a.status,
    }
  })
}

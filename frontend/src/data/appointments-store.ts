/**
 * The doctor's appointments, shared by the Consultations calendar, the Samvad
 * Assistant chat and the voice assistant, so a status changed in one shows in
 * the others.
 *
 * Loaded from the backend month by month (POST /api/fetch-appointments syncs
 * the doctor's Google Calendar and returns the appointments in a date range).
 * Status changes are saved with PATCH /api/appointments/{id}.
 */
import { useSyncExternalStore } from "react"

import type { AppointmentStatus, SampleAppointment } from "@/data/appointments"
import { api } from "@/lib/api"

export interface AppointmentsState {
  appointments: SampleAppointment[]
  /** True while any month is being fetched. */
  loading: boolean
  /** The last load error, cleared by a successful load. */
  error: string | null
}

let state: AppointmentsState = { appointments: [], loading: false, error: null }
const listeners = new Set<() => void>()
const loadedMonths = new Set<string>()
const inFlight = new Map<string, Promise<void>>()

function update(next: Partial<AppointmentsState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const byStart = (a: SampleAppointment, b: SampleAppointment) => (a.date + a.start).localeCompare(b.date + b.start)
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function getAppointments() {
  return state.appointments
}

const getState = () => state

/** Appointments only. */
export function useAppointments() {
  return useSyncExternalStore(subscribe, getAppointments)
}

/** Appointments plus loading and error state. */
export function useAppointmentsState() {
  return useSyncExternalStore(subscribe, getState)
}

/** Fetch the month containing `day` (once; `force` re-syncs it). Replaces that month's appointments. */
export function loadMonth(day: Date, { force = false } = {}): Promise<void> {
  const key = monthKey(day)
  if (!force && loadedMonths.has(key)) return Promise.resolve()
  const running = inFlight.get(key)
  if (running) return running

  const from = iso(new Date(day.getFullYear(), day.getMonth(), 1))
  const to = iso(new Date(day.getFullYear(), day.getMonth() + 1, 0))
  const request = (async () => {
    update({ loading: true })
    try {
      const res = await api("/fetch-appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      })
      const { appointments } = (await res.json()) as { appointments: SampleAppointment[] }
      loadedMonths.add(key)
      const others = state.appointments.filter((a) => a.date < from || a.date > to)
      update({ appointments: [...others, ...appointments].sort(byStart), error: null })
    } catch (err) {
      update({ error: errorMessage(err) })
    } finally {
      inFlight.delete(key)
      update({ loading: inFlight.size > 0 })
    }
  })()
  inFlight.set(key, request)
  return request
}

/** Re-sync every month loaded so far, or this month if none loaded (after an error). */
export async function reloadAppointments() {
  const months = loadedMonths.size ? [...loadedMonths] : [monthKey(new Date())]
  await Promise.all(
    months.map((key) => {
      const [y, m] = key.split("-").map(Number)
      return loadMonth(new Date(y, m - 1, 1), { force: true })
    }),
  )
}

/** Add appointments that arrived another way (e.g. in an assistant answer). */
export function mergeAppointments(incoming: SampleAppointment[]) {
  if (!incoming.length) return
  const ids = new Set(incoming.map((a) => a.id))
  update({ appointments: [...state.appointments.filter((a) => !ids.has(a.id)), ...incoming].sort(byStart) })
}

/** Change a status right away, save it, and put it back if saving fails. Rejects with the server's message. */
export async function setAppointmentStatus(id: string, status: AppointmentStatus) {
  const before = state.appointments.find((a) => a.id === id)
  if (!before || before.status === status) return
  const apply = (next: SampleAppointment) => update({ appointments: state.appointments.map((a) => (a.id === id ? next : a)) })
  apply({ ...before, status })
  try {
    const res = await api(`/appointments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    apply((await res.json()) as SampleAppointment)
  } catch (err) {
    apply(before)
    throw new Error(errorMessage(err))
  }
}

/** The calendar as the voice assistant reads it: one line of facts per appointment. */
export function calendarDigest() {
  return state.appointments.map((a) => ({
    id: a.id,
    date: a.date,
    start: a.start,
    end: a.end,
    patient: a.patient?.name ?? a.patientId,
    patient_id: a.patientId,
    doctor: a.doctor?.name ?? a.doctorId,
    department: a.doctor?.department ?? "",
    status: a.status,
  }))
}

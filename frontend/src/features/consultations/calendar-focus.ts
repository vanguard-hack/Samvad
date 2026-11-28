import type { NavigateFunction } from "react-router"

export const CALENDAR_PATH = "/consultations"

/** Router state that tells the Consultations calendar what to show: an appointment (with its details) or a day. */
export type CalendarFocusState = { focusAppointment?: string; focusDate?: string } | null

/** Opens the Consultations calendar, at an appointment or a day when given. */
export function openCalendar(navigate: NavigateFunction, target: { appointmentId?: string; date?: string } = {}) {
  const state: CalendarFocusState =
    target.appointmentId || target.date ? { focusAppointment: target.appointmentId, focusDate: target.date } : null
  navigate(CALENDAR_PATH, { state })
}

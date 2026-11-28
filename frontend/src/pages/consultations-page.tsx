import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { getAppointments, setAppointmentStatus, useAppointments } from "@/data/appointments-store"
import { AppointmentDialog } from "@/features/consultations/appointment-dialog"
import type { CalendarFocusState } from "@/features/consultations/calendar-focus"
import { EventCalendar, type CalendarFocus } from "@/features/consultations/event-calendar"

/** Consultations as an event calendar; a consultation opens its details dialog. */
export function ConsultationsPage() {
  const { t } = useTranslation()
  // Shared with the assistants (sample data held in memory).
  const appointments = useAppointments()
  const [openId, setOpenId] = useState<string | null>(null)
  const [focus, setFocus] = useState<CalendarFocus | null>(null)
  // Looked up by id so the dialog shows the latest status after a change.
  const open = appointments.find((a) => a.id === openId) ?? null

  // An assistant sent the doctor here: show that appointment on the calendar, with its details open.
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const state = location.state as CalendarFocusState
    if (!state?.focusAppointment && !state?.focusDate) return
    const target = state.focusAppointment ? getAppointments().find((a) => a.id === state.focusAppointment) : undefined
    const date = target?.date ?? state.focusDate
    if (date) setFocus({ key: location.key, date, id: target?.id })
    if (target) setOpenId(target.id)
    // Clear the request, so going back or reloading doesn't open it again.
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">
      <h1 className="sr-only">{t("consultations.title")}</h1>
      <EventCalendar appointments={appointments} focus={focus} onOpen={(a) => setOpenId(a.id)} />
      <AppointmentDialog appointment={open} onOpenChange={(next) => !next && setOpenId(null)} onStatusChange={setAppointmentStatus} />
    </div>
  )
}

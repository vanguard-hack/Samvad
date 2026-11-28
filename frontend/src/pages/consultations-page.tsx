import { Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import type { AppointmentStatus } from "@/data/appointments"
import { getAppointments, loadMonth, reloadAppointments, setAppointmentStatus, useAppointmentsState } from "@/data/appointments-store"
import { AppointmentDialog } from "@/features/consultations/appointment-dialog"
import type { CalendarFocusState } from "@/features/consultations/calendar-focus"
import { EventCalendar, type CalendarFocus } from "@/features/consultations/event-calendar"

/** Consultations as an event calendar, synced from the backend; a consultation opens its details dialog. */
export function ConsultationsPage() {
  const { t } = useTranslation()
  // Shared with the assistants; each month is fetched when it comes into view.
  const { appointments, loading, error } = useAppointmentsState()
  const [openId, setOpenId] = useState<string | null>(null)
  const [focus, setFocus] = useState<CalendarFocus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
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

  const changeStatus = (id: string, status: AppointmentStatus) => {
    setStatusError(null)
    setAppointmentStatus(id, status).catch((err: Error) => setStatusError(err.message))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4">
      <h1 className="sr-only">{t("consultations.title")}</h1>
      {(error || statusError) && (
        <div role="alert" className="flex items-center gap-2 rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">
            {statusError
              ? t("consultations.calendar.statusError", { message: statusError })
              : t("consultations.calendar.loadError", { message: error })}
          </span>
          {error && !statusError && (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void reloadAppointments()}>
              <RefreshCw />
              {t("consultations.calendar.retry")}
            </Button>
          )}
        </div>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("consultations.calendar.loading")}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <EventCalendar appointments={appointments} focus={focus} onOpen={(a) => setOpenId(a.id)} onMonthShown={loadMonth} />
      </div>
      <AppointmentDialog
        appointment={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(null)
          setStatusError(null)
        }}
        onStatusChange={changeStatus}
      />
    </div>
  )
}

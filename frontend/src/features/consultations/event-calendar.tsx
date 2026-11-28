import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Department, SampleAppointment } from "@/data/appointments"
import { DepartmentFilter, MiniCalendar, TimezoneNote, UpNext } from "./calendar-sidebar"
import {
  CALENDAR_VIEWS,
  DEPARTMENTS,
  appointmentMeta,
  parseIso,
  periodTitle,
  shiftAnchor,
  startOfDay,
  useNow,
  visibleHours,
  weekDays,
  type CalendarView,
} from "./calendar-utils"
import { AgendaView, MonthView, TimeGridView } from "./calendar-views"

/** What to bring into view: an appointment (highlighted) or just a day. `key` changes per request. */
export type CalendarFocus = { key: string; date: string; id?: string }

type Props = {
  appointments: SampleAppointment[]
  onOpen: (appointment: SampleAppointment) => void
  /** Show this appointment (or day), e.g. when an assistant sent the doctor here. */
  focus?: CalendarFocus | null
}

/**
 * The doctor's consultations as an event calendar, after the shadcn UI Kit
 * calendar app and the shadcn/studio event-calendar blocks: a sidebar (mini
 * month with booking dots, department filters, up next) beside a calendar with
 * Month, Week, Day and Agenda views. Read-only: doctors don't book here.
 */
export function EventCalendar({ appointments, onOpen, focus = null }: Props) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  // Phones start on the agenda: a month grid has no room for names there.
  const [view, setView] = useState<CalendarView>(() => (window.matchMedia("(max-width: 639px)").matches ? "agenda" : "month"))
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [visible, setVisible] = useState<Set<Department>>(() => new Set(DEPARTMENTS))
  // A new focus request moves the calendar there, with that department's filter on.
  const [seenFocus, setSeenFocus] = useState<string | null>(null)
  if (focus && focus.key !== seenFocus) {
    setSeenFocus(focus.key)
    setAnchor(startOfDay(parseIso(focus.date)))
    const target = focus.id ? appointments.find((a) => a.id === focus.id) : undefined
    const department = target ? appointmentMeta(target).department : undefined
    if (department && !visible.has(department)) setVisible(new Set([...visible, department]))
  }
  // The mini calendar follows the main view; its own arrows browse months from there.
  const [miniShift, setMiniShift] = useState({ anchor: anchor.getTime(), months: 0 })
  const shift = miniShift.anchor === anchor.getTime() ? miniShift.months : 0
  const miniMonth = new Date(anchor.getFullYear(), anchor.getMonth() + shift, 1)

  const shown = useMemo(() => appointments.filter((a) => visible.has(appointmentMeta(a).department)), [appointments, visible])
  const hours = useMemo(() => visibleHours(appointments), [appointments])

  // Scroll the focused appointment into view (week and day grids, the agenda list).
  const focusId = focus?.id
  const focusKey = focus?.key
  useEffect(() => {
    if (!focusId) return
    const frame = requestAnimationFrame(() =>
      document.querySelector(`[data-appointment="${focusId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    )
    return () => cancelAnimationFrame(frame)
  }, [focusId, focusKey, view])

  const goDay = (day: Date) => {
    setAnchor(startOfDay(day))
    setView("day")
  }
  const handlers = { onOpen, onDay: goDay }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-e lg:flex">
        <div className="border-b p-3">
          <MiniCalendar
            month={miniMonth}
            now={now}
            selected={anchor}
            appointments={shown}
            onMonth={(dir) => setMiniShift({ anchor: anchor.getTime(), months: shift + dir })}
            onSelect={(day) => setAnchor(startOfDay(day))}
          />
        </div>
        <div className="p-3">
          <DepartmentFilter visible={visible} onChange={setVisible} />
        </div>
        <div className="border-t p-3">
          <UpNext appointments={shown} now={now} onOpen={onOpen} />
        </div>
        <div className="mt-auto border-t px-3 py-2.5">
          <TimezoneNote />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            <CalendarDays />
            {t("consultations.calendar.today")}
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon-sm" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} aria-label={t("consultations.calendar.previous")}>
              <ChevronLeft className="rtl:-scale-x-100" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} aria-label={t("consultations.calendar.next")}>
              <ChevronRight className="rtl:-scale-x-100" />
            </Button>
          </div>
          <h2 className="me-auto text-base font-semibold sm:text-lg" aria-live="polite">
            {periodTitle(view, anchor, i18n.language)}
          </h2>
          <Select
            value={view}
            onValueChange={(v) => v && setView(v as CalendarView)}
            items={CALENDAR_VIEWS.map((v) => ({ value: v, label: t(`consultations.calendar.view.${v}`) }))}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={t("consultations.calendar.viewLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CALENDAR_VIEWS.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`consultations.calendar.view.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        <div className="min-h-0 flex-1">
          {view === "month" ? (
            <MonthView anchor={anchor} now={now} appointments={shown} highlightId={focusId} {...handlers} />
          ) : view === "agenda" ? (
            <AgendaView anchor={anchor} now={now} appointments={shown} highlightId={focusId} onOpen={onOpen} />
          ) : (
            <TimeGridView
              days={view === "week" ? weekDays(anchor) : [anchor]}
              now={now}
              hours={hours}
              appointments={shown}
              detailed={view === "day"}
              highlightId={focusId}
              {...handlers}
            />
          )}
        </div>
      </section>
    </div>
  )
}

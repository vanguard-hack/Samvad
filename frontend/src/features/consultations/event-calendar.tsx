import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react"
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
  /** Called with each day whose month comes into view (main view or mini calendar), to load it. */
  onMonthShown?: (day: Date) => void
  /** Start booking, at a slot clicked in the week/day grid or at the next half hour. */
  onBook?: (date: string, start: string) => void
}

/**
 * The doctor's consultations as an event calendar, after the shadcn UI Kit
 * calendar app and the shadcn/studio event-calendar blocks: a sidebar (mini
 * month with booking dots, department filters, up next) beside a calendar with
 * Month, Week, Day and Agenda views. Read-only: doctors don't book here.
 */
export function EventCalendar({ appointments, onOpen, focus = null, onMonthShown, onBook }: Props) {
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

  // Load what comes into view: the anchor's month, both ends of its week, and the mini calendar's month.
  const weekStart = weekDays(anchor)[0].getTime()
  const weekEnd = weekDays(anchor).at(-1)!.getTime()
  const miniTime = miniMonth.getTime()
  useEffect(() => {
    if (!onMonthShown) return
    for (const time of [anchor.getTime(), weekStart, weekEnd, miniTime]) onMonthShown(new Date(time))
  }, [anchor, weekStart, weekEnd, miniTime, onMonthShown])

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
  const handlers = { onOpen, onDay: goDay, onSlot: onBook }

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
          {onBook && (
            <Button size="sm" className="ms-auto" onClick={() => onBook(...nextHalfHour(anchor))}>
              <CalendarPlus />
              {t("consultations.booking.button")}
            </Button>
          )}
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

/** The first booking slot to suggest: the next half hour today, or 09:00 on a future day in view. */
function nextHalfHour(anchor: Date): [string, string] {
  const pad = (n: number) => String(n).padStart(2, "0")
  const now = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (anchor > now) return [iso(anchor), "09:00"]
  const minute = now.getHours() * 60 + now.getMinutes() + 30 - ((now.getMinutes() + 30) % 30)
  if (minute > 19 * 60 + 30) {
    // Too late today: tomorrow morning.
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return [iso(tomorrow), "09:00"]
  }
  return [iso(now), `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`]
}

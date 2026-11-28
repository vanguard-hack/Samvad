import { CalendarX2 } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import type { SampleAppointment } from "@/data/appointments"
import { AppointmentStatusBadge } from "@/features/consultations/columns"
import { getLanguage } from "@/i18n/languages"
import { formatTimeSlot, intlLocale } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AGENDA_DAYS,
  HOUR_PX,
  addDays,
  appointmentEnd,
  appointmentMeta,
  compactRange,
  compactTime,
  groupByDate,
  hourLabel,
  isSameDay,
  isoDate,
  layoutLanes,
  minutesOf,
  monthGrid,
  parseIso,
  startOfDay,
  timezoneOffset,
  weekdayLabels,
  DEPARTMENT_COLORS,
} from "./calendar-utils"

/** Marks the appointment an assistant pointed the doctor to. */
const FOCUS_RING = "ring-2 ring-primary ring-offset-1 ring-offset-card"

/** Pills a month cell shows before it has been measured. */
const MAX_PILLS = 3
/** Month cell geometry (px): one pill with its gap, the date and padding, the "+N more" line. */
const PILL_PX = 21
const CELL_CHROME_PX = 36
const MORE_PX = 17

type Handlers = {
  onOpen: (appointment: SampleAppointment) => void
  /** Show one day in the day view. */
  onDay: (day: Date) => void
}

// ── Month ────────────────────────────────────────────────────────────────────

export function MonthView({
  anchor,
  now,
  appointments,
  highlightId,
  onOpen,
  onDay,
}: Handlers & { anchor: Date; now: Date; appointments: SampleAppointment[]; highlightId?: string }) {
  const { t, i18n } = useTranslation()
  const days = monthGrid(anchor)
  const byDay = useMemo(() => groupByDate(appointments), [appointments])
  const full = new Intl.DateTimeFormat(intlLocale(i18n.language), { weekday: "long", day: "numeric", month: "long" })
  const weeks = days.length / 7

  // Show as many pills as the cells have room for, as the references do.
  const grid = useRef<HTMLDivElement>(null)
  const [rowPx, setRowPx] = useState(0)
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const measure = () => setRowPx(el.clientHeight / weeks)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [weeks])
  const capacity = (count: number) => {
    if (!rowPx) return count > MAX_PILLS ? MAX_PILLS - 1 : count
    if (count * PILL_PX <= rowPx - CELL_CHROME_PX) return count
    return Math.max(0, Math.floor((rowPx - CELL_CHROME_PX - MORE_PX) / PILL_PX))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekdayLabels(i18n.language, "short").map((name, i) => (
          <div key={i} className="py-2 text-center text-xs text-muted-foreground">
            {name}
          </div>
        ))}
      </div>
      <div
        ref={grid}
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(5.5rem, 1fr))` }}
      >
        {days.map((day) => {
          const iso = isoDate(day)
          const items = byDay.get(iso) ?? []
          const outside = day.getMonth() !== anchor.getMonth()
          const today = isSameDay(day, now)
          const fits = capacity(items.length)
          let shown = items.slice(0, fits)
          // Keep the focused appointment visible, even on a busy day.
          const focused = highlightId ? items.find((a) => a.id === highlightId) : undefined
          if (focused && fits > 0 && !shown.includes(focused)) shown = [...items.slice(0, fits - 1), focused]
          const more = items.length - shown.length
          return (
            <div
              key={iso}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 border-e border-b p-1.5 [&:nth-child(7n)]:border-e-0 [&:nth-last-child(-n+7)]:border-b-0",
                outside && "bg-muted/40",
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDay(day)
                }}
                aria-label={full.format(day)}
                className={cn(
                  "mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                  today ? "bg-foreground font-medium text-background" : outside ? "text-muted-foreground hover:bg-muted" : "hover:bg-muted",
                )}
              >
                {day.getDate()}
              </button>
              {shown.map((a) => (
                <EventPill key={a.id} appointment={a} now={now} highlighted={a.id === highlightId} onOpen={onOpen} />
              ))}
              {more > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDay(day)
                  }}
                  className="rounded-sm px-1.5 text-start text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {t("consultations.calendar.more", { count: more })}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A consultation in a month cell: soft department colour, time then patient; struck through once past. */
function EventPill({
  appointment: a,
  now,
  highlighted,
  onOpen,
}: {
  appointment: SampleAppointment
  now: Date
  highlighted: boolean
  onOpen: Handlers["onOpen"]
}) {
  const { i18n } = useTranslation()
  const { patient, department } = appointmentMeta(a)
  return (
    <button
      type="button"
      data-appointment={a.id}
      title={`${patient} · ${formatTimeSlot(a.start, a.end, i18n.language)}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(a)
      }}
      className={cn(
        "flex w-full min-w-0 items-baseline gap-1 rounded-sm px-1.5 py-0.5 text-start text-[11px] leading-4 transition-colors",
        highlighted && FOCUS_RING,
        DEPARTMENT_COLORS[department].event,
        appointmentEnd(a) < now && "line-through decoration-1",
      )}
    >
      <span className="shrink-0 opacity-60">{compactTime(a.start, i18n.language)}</span>
      <span className="truncate font-medium">{patient}</span>
    </button>
  )
}

// ── Week & day ───────────────────────────────────────────────────────────────

export function TimeGridView({
  days,
  now,
  hours: [startHour, endHour],
  appointments,
  detailed = false,
  highlightId,
  onOpen,
  onDay,
}: Handlers & {
  days: Date[]
  now: Date
  hours: [number, number]
  appointments: SampleAppointment[]
  detailed?: boolean
  highlightId?: string
}) {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const byDay = useMemo(() => groupByDate(appointments), [appointments])
  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`
  const lines = Array.from({ length: endHour - startHour - 1 }, (_, i) => startHour + 1 + i)
  const weekday = new Intl.DateTimeFormat(intlLocale(lang), { weekday: "short" })
  const scroller = useRef<HTMLDivElement>(null)

  // Open on the current time when today is in view, otherwise on the clinic morning.
  const rangeKey = `${isoDate(days[0])}:${days.length}`
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const current = new Date()
    const showsToday = days.some((d) => isSameDay(d, current))
    const minute = showsToday ? current.getHours() * 60 + current.getMinutes() - 90 : startHour * 60
    el.scrollTop = Math.max(0, ((minute - startHour * 60) / 60) * HOUR_PX)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the visible range changes
  }, [rangeKey, startHour])

  const nowMinute = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-center pb-2 text-[10px] text-muted-foreground">{timezoneOffset(lang)}</div>
        {days.map((d) => (
          <button
            key={isoDate(d)}
            type="button"
            onClick={() => onDay(d)}
            className={cn(
              "border-s py-2 text-center text-xs transition-colors",
              isSameDay(d, now) ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {weekday.format(d)} {d.getDate()}
          </button>
        ))}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: (endHour - startHour) * HOUR_PX }}>
          <div className="relative">
            {lines.map((h) => (
              <span
                key={h}
                className="absolute end-2 -translate-y-1/2 text-[10px] whitespace-nowrap text-muted-foreground"
                style={{ top: (h - startHour) * HOUR_PX }}
              >
                {hourLabel(h, lang)}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const iso = isoDate(d)
            const items = byDay.get(iso) ?? []
            const lanes = layoutLanes(items)
            const today = isSameDay(d, now)
            return (
              <div key={iso} className={cn("relative border-s", today && "bg-primary/[0.03]")}>
                {lines.map((h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t" style={{ top: (h - startHour) * HOUR_PX }} />
                ))}
                {items.map((a) => {
                  const lane = lanes.get(a.id) ?? { lane: 0, lanes: 1 }
                  const top = ((minutesOf(a.start) - startHour * 60) / 60) * HOUR_PX
                  const height = Math.max(20, ((minutesOf(a.end) - minutesOf(a.start)) / 60) * HOUR_PX - 2)
                  return (
                    <EventBlock
                      key={a.id}
                      highlighted={a.id === highlightId}
                      appointment={a}
                      now={now}
                      detailed={detailed}
                      tall={height >= 40}
                      onOpen={onOpen}
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lane.lanes}% - 4px)`,
                      }}
                    />
                  )
                })}
                {today && nowMinute >= startHour * 60 && nowMinute <= endHour * 60 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: ((nowMinute - startHour * 60) / 60) * HOUR_PX }}
                  >
                    <span className="-ms-1 size-2 rounded-full bg-destructive" />
                    <span className="h-px flex-1 bg-destructive" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventBlock({
  appointment: a,
  now,
  detailed,
  tall,
  highlighted,
  style,
  onOpen,
}: {
  appointment: SampleAppointment
  now: Date
  detailed: boolean
  tall: boolean
  highlighted: boolean
  style: CSSProperties
  onOpen: Handlers["onOpen"]
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { patient, doctor, department } = appointmentMeta(a)
  const detail = doctor ? `${doctor.name} · ${t(`consultations.department.${department}`)}` : ""
  return (
    <button
      type="button"
      style={style}
      data-appointment={a.id}
      title={`${patient} · ${formatTimeSlot(a.start, a.end, lang)}${detail ? ` · ${detail}` : ""}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(a)
      }}
      className={cn(
        "absolute z-[1] flex overflow-hidden rounded-md px-1.5 text-start text-[11px] leading-tight transition-colors",
        highlighted && FOCUS_RING,
        tall ? "flex-col gap-0.5 py-1" : "items-center gap-1",
        DEPARTMENT_COLORS[department].event,
        appointmentEnd(a) < now && "line-through decoration-1",
      )}
    >
      {tall ? (
        <>
          <span className="truncate font-medium">{patient}</span>
          <span className="truncate opacity-70">{compactRange(a.start, a.end, lang)}</span>
          {detailed && <span className="truncate opacity-70">{detail}</span>}
        </>
      ) : (
        <>
          <span className="shrink-0 opacity-60">{compactTime(a.start, lang)}</span>
          <span className="truncate font-medium">{patient}</span>
          {detailed && <span className="truncate opacity-60">· {detail}</span>}
        </>
      )}
    </button>
  )
}

// ── Agenda ───────────────────────────────────────────────────────────────────

export function AgendaView({
  anchor,
  now,
  appointments,
  highlightId,
  onOpen,
}: Pick<Handlers, "onOpen"> & { anchor: Date; now: Date; appointments: SampleAppointment[]; highlightId?: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const start = startOfDay(anchor)
  const end = addDays(start, AGENDA_DAYS)
  const groups = useMemo(() => {
    const inRange = appointments.filter((a) => {
      const d = parseIso(a.date)
      return d >= start && d < end
    })
    return [...groupByDate(inRange).entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/end derive from anchor
  }, [appointments, anchor])
  const dayMonth = new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short" })
  const weekday = new Intl.DateTimeFormat(intlLocale(lang), { weekday: "long" })

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <CalendarX2 className="size-7" aria-hidden="true" />
        {t("consultations.calendar.empty")}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {groups.map(([iso, items]) => {
        const day = parseIso(iso)
        return (
          <section key={iso} className="mb-5 last:mb-0">
            <div className="mb-2 flex items-center gap-3">
              <h3 className={cn("shrink-0 text-xs font-medium uppercase", isSameDay(day, now) ? "text-foreground" : "text-muted-foreground")}>
                {dayMonth.format(day)}, {weekday.format(day)}
              </h3>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              {items.map((a) => {
                const { patient, doctor, department } = appointmentMeta(a)
                return (
                  <button
                    key={a.id}
                    type="button"
                    data-appointment={a.id}
                    onClick={() => onOpen(a)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-start transition-colors",
                      DEPARTMENT_COLORS[department].event,
                      a.id === highlightId && FOCUS_RING,
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm font-medium", appointmentEnd(a) < now && "line-through decoration-1")}>{patient}</span>
                      <AppointmentStatusBadge status={a.status} />
                    </span>
                    <span className="text-xs opacity-70">
                      {formatTimeSlot(a.start, a.end, lang)}
                      {doctor && ` · ${doctor.name}`}
                    </span>
                    <span className="text-xs opacity-80">
                      {t(`consultations.department.${department}`)} · {getLanguage(a.language).englishName} ·{" "}
                      {t("consultations.calendar.visit", { n: a.visit })}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

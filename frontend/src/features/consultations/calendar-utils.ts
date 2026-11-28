import { useEffect, useState } from "react"

import type { Department, SampleAppointment } from "@/data/appointments"
import { formatClock, intlLocale } from "@/lib/format"

export type CalendarView = "month" | "week" | "day" | "agenda"
export const CALENDAR_VIEWS: readonly CalendarView[] = ["month", "week", "day", "agenda"]
export const DEPARTMENTS: readonly Department[] = ["generalMedicine", "cardiology", "endocrinology", "orthopaedics", "pulmonology"]

/** Days the agenda lists from its start date. */
export const AGENDA_DAYS = 30
/** Height of one hour in the week and day views (1px per minute). */
export const HOUR_PX = 60

/**
 * One colour family per department, the way the reference calendars colour
 * events by category: soft fill with dark text, a solid dot, a filled checkbox.
 */
export const DEPARTMENT_COLORS: Record<Department, { event: string; dot: string; check: string }> = {
  generalMedicine: {
    event: "bg-sky-100 text-sky-950 hover:bg-sky-200/70 dark:bg-sky-500/15 dark:text-sky-100 dark:hover:bg-sky-500/25",
    dot: "bg-sky-500",
    check: "data-checked:border-sky-500 data-checked:bg-sky-500 dark:data-checked:bg-sky-500",
  },
  cardiology: {
    event: "bg-rose-100 text-rose-950 hover:bg-rose-200/70 dark:bg-rose-500/15 dark:text-rose-100 dark:hover:bg-rose-500/25",
    dot: "bg-rose-500",
    check: "data-checked:border-rose-500 data-checked:bg-rose-500 dark:data-checked:bg-rose-500",
  },
  endocrinology: {
    event: "bg-violet-100 text-violet-950 hover:bg-violet-200/70 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:bg-violet-500/25",
    dot: "bg-violet-500",
    check: "data-checked:border-violet-500 data-checked:bg-violet-500 dark:data-checked:bg-violet-500",
  },
  orthopaedics: {
    event: "bg-amber-100 text-amber-950 hover:bg-amber-200/70 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25",
    dot: "bg-amber-500",
    check: "data-checked:border-amber-500 data-checked:bg-amber-500 dark:data-checked:bg-amber-500",
  },
  pulmonology: {
    event: "bg-emerald-100 text-emerald-950 hover:bg-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-100 dark:hover:bg-emerald-500/25",
    dot: "bg-emerald-500",
    check: "data-checked:border-emerald-500 data-checked:bg-emerald-500 dark:data-checked:bg-emerald-500",
  },
}

// ── Dates (local time; weeks start on Sunday, as in the references) ─────────

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -d.getDay())
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Date → "2026-11-28" (local). */
export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** "09:30" → 570 */
export function minutesOf(hm: string) {
  const [h, m] = hm.split(":").map(Number)
  return h * 60 + m
}

/** 570 → "09:30" */
export function hmOf(minutes: number) {
  const m = Math.max(0, Math.min(23 * 60 + 59, minutes))
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** The Sunday-to-Saturday weeks covering a month (5 or 6 rows). */
export function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const weeks = Math.ceil((first.getDay() + days) / 7)
  const start = startOfWeek(first)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Moves the visible period one step back (-1) or forward (+1). */
export function shiftAnchor(view: CalendarView, anchor: Date, dir: 1 | -1) {
  if (view === "month") {
    const y = anchor.getFullYear()
    const m = anchor.getMonth() + dir
    const last = new Date(y, m + 1, 0).getDate()
    return new Date(y, m, Math.min(anchor.getDate(), last))
  }
  return addDays(anchor, dir * (view === "week" ? 7 : view === "day" ? 1 : AGENDA_DAYS))
}

// ── Formatting ───────────────────────────────────────────────────────────────

const fmt = (lang: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(lang), options)

/** "November 2026", "22–28 Nov 2026", "Saturday 28 November 2026", "Nov – Dec 2026". */
export function periodTitle(view: CalendarView, anchor: Date, lang: string) {
  if (view === "month") return fmt(lang, { month: "long", year: "numeric" }).format(anchor)
  if (view === "day") return fmt(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(anchor)
  if (view === "week") {
    const start = startOfWeek(anchor)
    return fmt(lang, { day: "numeric", month: "short", year: "numeric" }).formatRange(start, addDays(start, 6))
  }
  const start = startOfDay(anchor)
  return fmt(lang, { month: "short", year: "numeric" }).formatRange(start, addDays(start, AGENDA_DAYS - 1))
}

/** Sunday-first weekday names: "Sun" (grid) or "Su" (mini calendar). */
export function weekdayLabels(lang: string, style: "short" | "mini") {
  const english = intlLocale(lang).startsWith("en")
  const f = fmt(lang, { weekday: style === "mini" && !english ? "narrow" : "short" })
  // 1 January 2023 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const name = f.format(new Date(2023, 0, 1 + i))
    return style === "mini" && english ? name.slice(0, 2) : name
  })
}

/** "9am", "3:30pm" in English, as the references show times; the locale's clock otherwise. */
export function compactTime(hm: string, lang: string) {
  if (!intlLocale(lang).startsWith("en")) return formatClock(hm, lang)
  const [h, m] = hm.split(":").map(Number)
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`
}

export function compactRange(start: string, end: string, lang: string) {
  return `${compactTime(start, lang)} – ${compactTime(end, lang)}`
}

export function hourLabel(hour: number, lang: string) {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return fmt(lang, { hour: "numeric" }).format(d)
}

/** "GMT+5:30" */
export function timezoneOffset(lang: string) {
  return fmt(lang, { timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? ""
}

// ── Appointments ─────────────────────────────────────────────────────────────

export function appointmentMeta(a: SampleAppointment) {
  const doctor = a.doctor
  const department: Department = doctor?.department ?? "generalMedicine"
  return { patient: a.patient?.name ?? a.patientId, doctor, department }
}

export function appointmentStart(a: SampleAppointment) {
  const d = parseIso(a.date)
  d.setHours(0, minutesOf(a.start), 0, 0)
  return d
}

export function appointmentEnd(a: SampleAppointment) {
  const d = parseIso(a.date)
  d.setHours(0, minutesOf(a.end), 0, 0)
  return d
}

export const byStart = (a: SampleAppointment, b: SampleAppointment) =>
  a.date === b.date ? minutesOf(a.start) - minutesOf(b.start) : a.date < b.date ? -1 : 1

/** Appointments by ISO date, each day sorted by start time. */
export function groupByDate(list: SampleAppointment[]) {
  const map = new Map<string, SampleAppointment[]>()
  for (const a of [...list].sort(byStart)) map.set(a.date, [...(map.get(a.date) ?? []), a])
  return map
}

/** Hours shown in the week and day views: clinic hours, widened to fit every appointment. */
export function visibleHours(list: SampleAppointment[]): [number, number] {
  let start = 8
  let end = 20
  for (const a of list) {
    start = Math.min(start, Math.floor(minutesOf(a.start) / 60))
    end = Math.max(end, Math.ceil(minutesOf(a.end) / 60))
  }
  return [start, end]
}

/** Side-by-side lanes for overlapping appointments in one day column. */
export function layoutLanes(list: SampleAppointment[]) {
  const result = new Map<string, { lane: number; lanes: number }>()
  let cluster: string[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const id of cluster) result.get(id)!.lanes = laneEnds.length
    cluster = []
    laneEnds = []
    clusterEnd = -1
  }
  for (const a of [...list].sort(byStart)) {
    const s = minutesOf(a.start)
    const e = minutesOf(a.end)
    if (cluster.length && s >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(e)
    } else laneEnds[lane] = e
    result.set(a.id, { lane, lanes: 1 })
    cluster.push(a.id)
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return result
}

/** The current time, refreshed every minute (now line, past events). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

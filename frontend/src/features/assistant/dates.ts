import { daysAgo } from "@/data/sample"
import type { DateRange, DateRangeKind } from "@/features/assistant/types"

/** Local ISO date for today (same rule as the sample data). */
export const todayIso = () => daysAgo(0)

export function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function addDays(iso: string, n: number) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string) {
  return (parseIso(iso).getDay() + 6) % 7
}

function monthBounds(iso: string, offset: number) {
  const d = parseIso(iso)
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0)
  return { from: toIso(first), to: toIso(last) }
}

/** A named range relative to `today`. */
export function namedRange(kind: Exclude<DateRangeKind, "day" | "nextDays" | "lastDays">, today: string): DateRange {
  const monday = addDays(today, -weekdayIndex(today))
  switch (kind) {
    case "today":
      return { kind, from: today, to: today }
    case "tomorrow": {
      const d = addDays(today, 1)
      return { kind, from: d, to: d }
    }
    case "yesterday": {
      const d = addDays(today, -1)
      return { kind, from: d, to: d }
    }
    case "thisWeek":
      return { kind, from: monday, to: addDays(monday, 6) }
    case "nextWeek":
      return { kind, from: addDays(monday, 7), to: addDays(monday, 13) }
    case "lastWeek":
      return { kind, from: addDays(monday, -7), to: addDays(monday, -1) }
    case "thisMonth":
      return { kind, ...monthBounds(today, 0) }
    case "nextMonth":
      return { kind, ...monthBounds(today, 1) }
    case "lastMonth":
      return { kind, ...monthBounds(today, -1) }
    case "upcoming":
      return { kind, from: today }
    case "past":
      return { kind, to: addDays(today, -1) }
  }
}

export function dayRange(iso: string): DateRange {
  return { kind: "day", from: iso, to: iso }
}

export function inRange(iso: string, range: DateRange | undefined) {
  if (!range) return true
  return (!range.from || iso >= range.from) && (!range.to || iso <= range.to)
}

export function isSingleDay(range: DateRange | undefined): range is DateRange & { from: string; to: string } {
  return !!range?.from && range.from === range.to
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export function fromMinutes(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
}

/** Minutes since local midnight. */
export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes()
}

import { PRIORITIES, type PatientRow, type Priority, type QueueStatus } from "./patients-api"

/** Priority badge colours: safety semantics only (danger / caution / neutral). */
export const PRIORITY_STYLE: Record<Priority | "none", string> = {
  high: "border-transparent bg-danger-soft text-danger",
  medium: "border-transparent bg-caution-soft text-caution",
  low: "border-transparent bg-secondary text-secondary-foreground",
  none: "border-dashed text-muted-foreground",
}

export const STATUS_STYLE: Record<QueueStatus, string> = {
  needs_action: "border-transparent bg-danger-soft text-danger",
  in_progress: "border-transparent bg-primary/10 text-primary",
  waiting: "border-transparent bg-caution-soft text-caution",
  completed: "border-transparent bg-verified-soft text-verified",
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 }

/**
 * Clinical-operational urgency: doctor-set priority first, then soonest due
 * (overdue first), then the most recent activity.
 */
export function byUrgency(a: PatientRow, b: PatientRow) {
  const p = PRIORITY_RANK[a.priority ?? "none"] - PRIORITY_RANK[b.priority ?? "none"]
  if (p) return p
  return byDue(a, b) || +new Date(b.last_event_at) - +new Date(a.last_event_at)
}

export function byDue(a: PatientRow, b: PatientRow) {
  const da = a.due_at ? +new Date(a.due_at) : Infinity
  const db = b.due_at ? +new Date(b.due_at) : Infinity
  return da === db ? 0 : da < db ? -1 : 1
}

export const byLastEvent = (a: PatientRow, b: PatientRow) => +new Date(b.last_event_at) - +new Date(a.last_event_at)

export const PRIORITY_OPTIONS = [...PRIORITIES, "none"] as const

/** "28 min", "3 hr", "2 days" in the UI language. */
export function shortDuration(ms: number, lang: string) {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60000))
  const [value, unit] = min < 60 ? [min, "minute"] : min < 60 * 24 ? [Math.round(min / 60), "hour"] : [Math.round(min / 1440), "day"]
  return new Intl.NumberFormat(lang, { style: "unit", unit, unitDisplay: unit === "day" ? "long" : "short" }).format(value)
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "10:30 AM" today, otherwise "Sep 28, 10:30 AM". */
export function clockLabel(iso: string, lang: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })
  return sameDay(d, new Date()) ? time : `${d.toLocaleDateString(lang, { month: "short", day: "numeric" })}, ${time}`
}

/** "today, 7:42 AM" / "yesterday, 3:18 PM" / "Sep 28". */
export function eventWhen(iso: string, lang: string) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  const time = d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })
  if (days <= 1) return `${new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-days, "day")}, ${time}`
  return d.toLocaleDateString(lang, { month: "short", day: "numeric" })
}

import type { AppointmentStatus, Department } from "@/data/appointments"
import { addDays, dayRange, namedRange, parseIso, toIso, weekdayIndex } from "@/features/assistant/dates"
import type { AppointmentFilters, DateRange, Intent } from "@/features/assistant/types"

/** Names the parser can recognise in a question. */
export interface Directory {
  patients: { id: string; name: string }[]
  doctors: { id: string; name: string; department: Department }[]
  languages: { code: string; name: string }[]
}

export interface ParsedQuery {
  /** Intent stated in this question; undefined when it only adds filters. */
  intent?: Intent
  /** Filters named in this question alone. */
  filters: AppointmentFilters
  appointmentId?: string
  /** "he", "she", "this patient": the patient from earlier in the conversation. */
  patientPronoun: boolean
  /** Builds on the previous question ("and tomorrow?", "only those needing review"). */
  followUp: boolean
  /** Starts over ("all appointments", "start over"). */
  reset: boolean
  /** Mentions appointments, visits or the schedule. */
  aboutSchedule: boolean
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

const DEPARTMENTS: [Department, RegExp][] = [
  ["cardiology", /\b(cardiology|cardiologist|cardio|cardiac|heart)\b/],
  ["endocrinology", /\b(endocrinology|endocrinologist|endo|diabetes|diabetic|thyroid)\b/],
  ["orthopaedics", /\b(orthopa?edics?|orthopa?edic|ortho|bones?|joints?)\b/],
  ["pulmonology", /\b(pulmonology|pulmonologist|pulmo|lungs?|chest|respiratory)\b/],
  ["generalMedicine", /\b(general medicine|general physician|gp|physician)\b/],
]

const STATUSES: [AppointmentStatus, RegExp][] = [
  ["needsReview", /\b(needs? (my |a )?review|needing review|to review|pending review|review|unreviewed)\b/],
  ["followUp", /\bfollow[- ]?ups?\b/],
  ["active", /\b(active|ongoing|in progress|live|in session)\b/],
  ["scheduled", /\b(scheduled|booked|confirmed|pending(?! review))\b/],
  ["closed", /\b(closed|completed?|done|finished|seen)\b/],
]

const FOLLOW_UP_START =
  /^(and|what about|how about|what of|only|just|also|now|then|same|those|these|of those|of them|among|filter|but|plus|with|for|in|on|from)\b/
const PLURAL_PRONOUN = /\b(they|them|those|these|their)\b/
const SINGULAR_PRONOUN = /\b(he|she|him|her|his|hers|this patient|that patient|the patient|same patient)\b/
const BARE_CARRY: Intent[] = ["count", "summary", "next", "last", "doctors", "freeSlots", "list"]
const RESET = /\b(all|every|everything|everyone|start over|reset|clear( the)? filters?)\b/
const SCHEDULE_WORDS =
  /\b(appointments?|appts?|schedule[sd]?|consultations?|visits?|bookings?|agenda|calendar|slots?|list|show|patients?|queue|clinic)\b/

export function normalize(raw: string) {
  return raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’‘`]/g, "'")
    .replace(/[?!.,;:"“”()]+(?=\s|$)/g, " ")
    .replace(/[?!,;"“”()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const words = (q: string) => q.split(" ").filter(Boolean)

/** Edit distance, for typo-tolerant name matching. */
function distance(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const hasWord = (q: string, w: string) => new RegExp(`(^|[^a-z])${escape(w)}('s)?($|[^a-z])`).test(q)

/**
 * Best match for a person's name: the full name, then any part of it, then a
 * near miss (one typo) on a longer name part.
 */
function matchName<T extends { name: string }>(q: string, people: T[], strip: RegExp = /^$/): T | undefined {
  const parts = (p: T) => normalize(p.name).replace(strip, "").split(" ").filter((w) => w.length > 2)
  const full = people.find((p) => hasWord(q, normalize(p.name).replace(strip, "")))
  if (full) return full
  const partial = people.find((p) => parts(p).some((w) => hasWord(q, w)))
  if (partial) return partial
  const qWords = words(q).map((w) => w.replace(/'s$/, ""))
  return people.find((p) => parts(p).some((w) => w.length >= 6 && qWords.some((qw) => qw.length >= 5 && distance(qw, w) <= 1)))
}

function nearestWeekday(today: string, target: number, mode: "this" | "next" | "last") {
  const diff = (target - weekdayIndex(today) + 7) % 7
  if (mode === "last") return addDays(today, -(((weekdayIndex(today) - target + 7) % 7) || 7))
  if (mode === "next") return addDays(today, diff || 7)
  return addDays(today, diff)
}

/** Day-month dates ("28 nov", "nov 28th", "28/11", "2026-11-28") in the current year. */
function explicitDate(q: string, today: string): string | undefined {
  const iso = q.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return toIso(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))

  const year = parseIso(today).getFullYear()
  const make = (day: number, month: number, y = year) =>
    month >= 0 && month < 12 && day >= 1 && day <= 31 ? toIso(new Date(y, month, day)) : undefined

  const slash = q.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (slash) {
    const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : year
    return make(Number(slash[1]), Number(slash[2]) - 1, y) // India: day first
  }
  const month = `(${MONTHS.join("|")})[a-z]*`
  const dm = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${month}\\b`))
  if (dm) return make(Number(dm[1]), MONTHS.indexOf(dm[2]))
  const md = q.match(new RegExp(`\\b${month} (\\d{1,2})(?:st|nd|rd|th)?\\b`))
  if (md) return make(Number(md[2]), MONTHS.indexOf(md[1]))
  return undefined
}

export function parseDateRange(q: string, today: string): DateRange | undefined {
  if (/\bday after tomorrow\b/.test(q)) return dayRange(addDays(today, 2))
  if (/\bday before yesterday\b/.test(q)) return dayRange(addDays(today, -2))
  if (/\b(today|today's|tonight|this (morning|afternoon|evening))\b/.test(q)) return namedRange("today", today)
  if (/\b(tomorrow|tomorrow's|tmrw|tmr)\b/.test(q)) return namedRange("tomorrow", today)
  if (/\b(yesterday|yesterday's)\b/.test(q)) return namedRange("yesterday", today)
  if (/\bthis week\b/.test(q)) return namedRange("thisWeek", today)
  if (/\bnext week\b/.test(q)) return namedRange("nextWeek", today)
  if (/\b(last|past|previous) week\b/.test(q)) return namedRange("lastWeek", today)
  if (/\bthis month\b/.test(q)) return namedRange("thisMonth", today)
  if (/\bnext month\b/.test(q)) return namedRange("nextMonth", today)
  if (/\b(last|past|previous) month\b/.test(q)) return namedRange("lastMonth", today)

  const ahead = q.match(/\b(?:next|coming|upcoming|within) (\d{1,3}) days?\b/)
  if (ahead) {
    const days = Number(ahead[1])
    return { kind: "nextDays", from: today, to: addDays(today, days), days }
  }
  const behind = q.match(/\b(?:last|past|previous) (\d{1,3}) days?\b/)
  if (behind) {
    const days = Number(behind[1])
    return { kind: "lastDays", from: addDays(today, -days), to: today, days }
  }

  const date = explicitDate(q, today)
  if (date) return dayRange(date)

  const wd = q.match(new RegExp(`\\b(?:(this|next|last|on|coming) )?(${WEEKDAYS.join("|")})\\b`))
  if (wd) {
    const mode = wd[1] === "next" ? "next" : wd[1] === "last" ? "last" : "this"
    return dayRange(nearestWeekday(today, WEEKDAYS.indexOf(wd[2]), mode))
  }

  if (/\b(upcoming|future|coming up|ahead|later|from now)\b/.test(q)) return namedRange("upcoming", today)
  if (/\b(past|previous|earlier|history|before|so far|old)\b/.test(q)) return namedRange("past", today)
  return undefined
}

function parseIntent(q: string, f: AppointmentFilters, hasAppointmentId: boolean): Intent | undefined {
  const n = words(q).length
  if (hasAppointmentId) return "details"
  if (n <= 4 && /^(hi|hello|hey|hii+|namaste|namaskar|good (morning|afternoon|evening))\b/.test(q)) return "greeting"
  if (n <= 5 && /\b(thanks|thank you|thx|ty|great|perfect|awesome|ok thanks|cool)\b/.test(q)) return "thanks"
  if (/\b(help|what can you do|how do i|how does this work|examples?|what can i ask)\b/.test(q)) return "help"
  if (/\b(free|availab\w*|open slots?|gaps?|vacant|empty slots?)\b/.test(q)) return "freeSlots"
  if (!f.patientId && /\b(doctors|which doctors?|who('s| is)? (seeing|working|on duty|in)|on duty|on call|staff)\b/.test(q))
    return "doctors"
  if (/\b(summary|summari[sz]e|overview|breakdown|stats|statistics|how busy|snapshot|at a glance|brief me)\b/.test(q))
    return "summary"
  if (/\b(how many|count|number of|total)\b/.test(q)) return "count"
  if (/\b(next|upcoming|coming) (appointment|appt|visit|slot|consultation|one)\b/.test(q) || /\bwhen (is|does|will)\b/.test(q))
    return "next"
  if (/\b(last|previous|most recent|latest) (appointment|appt|visit|consultation|one)\b/.test(q) || /\bwhen (was|did)\b/.test(q))
    return "last"
  if (/\b(who is|who's|tell me about|know about|profile|details|info|information|record)\b/.test(q) && !/\bappointments\b/.test(q))
    return "patient"
  return undefined
}

export function parseQuery(raw: string, dir: Directory, today: string): ParsedQuery {
  const q = normalize(raw)
  const filters: AppointmentFilters = {}

  const aptId = q.match(/\bapt[- ]?(\d{4})\b/)
  const patientId = q.match(/\bsmv[- ]?(\d{4})\b/)
  const doctorId = q.match(/\bdoc[- ]?(\d{1,2})\b/)

  if (patientId) filters.patientId = `SMV-${patientId[1]}`
  if (doctorId) filters.doctorId = `DOC-${doctorId[1].padStart(2, "0")}`

  // Doctors first ("Dr. Joshi"), so a doctor's name never reads as a patient.
  if (!filters.doctorId) {
    const doctor = matchName(q, dir.doctors, /^dr /)
    if (doctor) filters.doctorId = doctor.id
  }
  if (!filters.patientId) {
    const patient = matchName(q, dir.patients)
    if (patient) filters.patientId = patient.id
  }
  if (!filters.doctorId) {
    const department = DEPARTMENTS.find(([, re]) => re.test(q))?.[0]
    if (department) filters.department = department
  }

  const status = STATUSES.filter(([, re]) => re.test(q)).map(([s]) => s)
  if (status.length) filters.status = status

  const language = dir.languages.find((l) => l.code !== "en" && hasWord(q, l.name.toLowerCase()))
  if (language) filters.language = language.code

  const range = parseDateRange(q, today)
  if (range) filters.range = range

  const intent = parseIntent(q, filters, !!aptId)
  const reset = RESET.test(q)
  const patientPronoun = !filters.patientId && SINGULAR_PRONOUN.test(q)
  const hasFilters = Object.keys(filters).length > 0
  const followUp =
    !reset &&
    (FOLLOW_UP_START.test(q) ||
      PLURAL_PRONOUN.test(q) ||
      patientPronoun ||
      (hasFilters && !intent && !SCHEDULE_WORDS.test(q) && words(q).length <= 5) ||
      // "How many?", "Summary", "Last visit": the question applies to what we were just looking at.
      (!hasFilters && !!intent && BARE_CARRY.includes(intent) && words(q).length <= 4))

  return {
    intent,
    filters,
    appointmentId: aptId ? `APT-${aptId[1]}` : undefined,
    patientPronoun,
    followUp,
    reset,
    aboutSchedule: SCHEDULE_WORDS.test(q),
  }
}

import { APPOINTMENT_STATUSES, type AppointmentStatus, type SampleAppointment } from "@/data/appointments"
import {
  dayRange,
  fromMinutes,
  inRange,
  isSingleDay,
  namedRange,
  nowMinutes,
  todayIso,
  toMinutes,
} from "@/features/assistant/dates"
import { parseQuery, type Directory, type ParsedQuery } from "@/features/assistant/parse"
import type {
  AppointmentFilters,
  AssistantEngine,
  AssistantReply,
  AssistantResponse,
  ConversationContext,
  Intent,
  Message,
  ReplyBlock,
  ScheduleData,
  Suggestion,
  TimeSlot,
} from "@/features/assistant/types"
import { LANGUAGES } from "@/i18n/languages"

/** Clinic hours used for free-slot answers: 9–1 and 2–5, in 30-minute steps. */
const CLINIC_SESSIONS: [string, string][] = [
  ["09:00", "13:00"],
  ["14:00", "17:00"],
]
const SLOT_MINUTES = 30

/** Intents a bare follow-up ("and tomorrow?") repeats. */
const CARRIED_INTENTS: Intent[] = ["list", "count", "summary", "freeSlots", "doctors", "next", "last"]

export interface Clock {
  today: string
  minutes: number
}

const byTime = (a: SampleAppointment, b: SampleAppointment) =>
  a.date.localeCompare(b.date) || a.start.localeCompare(b.start)

const msg = (key: string, values?: Message["values"]): Message => ({ key, values })
const firstName = (name: string) => name.split(" ")[0]

function hasFilters(f: AppointmentFilters) {
  return Object.values(f).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0))
}

/** A follow-up's filters over the conversation's: a new doctor replaces the department and vice versa. */
function mergeFilters(prev: AppointmentFilters, next: AppointmentFilters): AppointmentFilters {
  const merged = { ...prev, ...next }
  if (next.department) delete merged.doctorId
  if (next.doctorId) delete merged.department
  return merged
}

function directory(data: ScheduleData): Directory {
  return {
    patients: data.patients.map((p) => ({ id: p.id, name: p.name })),
    doctors: data.doctors,
    languages: LANGUAGES.map((l) => ({ code: l.code, name: l.englishName })),
  }
}

function select(data: ScheduleData, f: AppointmentFilters) {
  const department = (doctorId: string) => data.doctors.find((d) => d.id === doctorId)?.department
  return data.appointments
    .filter(
      (a) =>
        (!f.patientId || a.patientId === f.patientId) &&
        (!f.doctorId || a.doctorId === f.doctorId) &&
        (!f.department || department(a.doctorId) === f.department) &&
        (!f.status?.length || f.status.includes(a.status)) &&
        (!f.language || a.language === f.language) &&
        inRange(a.date, f.range),
    )
    .sort(byTime)
}

const isUpcoming = (a: SampleAppointment, c: Clock) =>
  a.status !== "closed" && (a.date > c.today || (a.date === c.today && toMinutes(a.end) > c.minutes))
const isPast = (a: SampleAppointment, c: Clock) =>
  a.date < c.today || (a.date === c.today && toMinutes(a.end) <= c.minutes)

/** Free time in clinic hours for one doctor on one day. */
function freeSlots(data: ScheduleData, doctorId: string, date: string, c: Clock): TimeSlot[] {
  const busy = data.appointments
    .filter((a) => a.doctorId === doctorId && a.date === date)
    .map((a) => [toMinutes(a.start), toMinutes(a.end)] as const)
  const floor = date === c.today ? Math.ceil(c.minutes / SLOT_MINUTES) * SLOT_MINUTES : 0
  const slots: TimeSlot[] = []
  for (const [open, close] of CLINIC_SESSIONS) {
    let run: number | null = null
    for (let t = Math.max(toMinutes(open), floor); t + SLOT_MINUTES <= toMinutes(close); t += SLOT_MINUTES) {
      const taken = busy.some(([s, e]) => s < t + SLOT_MINUTES && e > t)
      if (!taken && run === null) run = t
      if (taken && run !== null) {
        slots.push({ start: fromMinutes(run), end: fromMinutes(t) })
        run = null
      }
    }
    if (run !== null) slots.push({ start: fromMinutes(run), end: close })
  }
  return slots
}

function appointmentMessage(key: string, a: SampleAppointment, data: ScheduleData) {
  return msg(key, {
    patient: data.patients.find((p) => p.id === a.patientId)?.name ?? a.patientId,
    doctor: data.doctors.find((d) => d.id === a.doctorId)?.name ?? a.doctorId,
    date: { date: a.date },
    time: { time: a.start },
  })
}

// ── Suggestions ────────────────────────────────────────────────────────────

function suggestions(intent: Intent, f: AppointmentFilters, data: ScheduleData): Suggestion[] {
  const out: Suggestion[] = []
  const add = (s: Suggestion) => out.some((o) => o.query === s.query) || out.push(s)
  const patient = data.patients.find((p) => p.id === f.patientId)
  const doctor = data.doctors.find((d) => d.id === f.doctorId)

  if (patient) {
    const name = firstName(patient.name)
    if (intent !== "next") add({ label: msg("suggest.nextFor", { name }), query: `next appointment for ${patient.name}` })
    if (intent !== "calendar") add({ label: msg("suggest.openCalendar", { name }), query: `show ${patient.name}'s appointment details` })
    if (intent !== "patient") add({ label: msg("suggest.profile", { name }), query: `tell me about ${patient.name}` })
    add({ label: msg("suggest.historyFor", { name }), query: `past appointments for ${patient.name}` })
  }
  if (doctor) {
    add({ label: msg("suggest.doctorFree", { doctor: doctor.name }), query: `free slots tomorrow for ${doctor.name}` })
  }
  if (!patient && ["list", "count", "summary", "doctors"].includes(intent)) {
    if (!f.status?.includes("needsReview")) add({ label: msg("suggest.onlyReview"), query: "only those that need review" })
    if (f.range?.kind !== "tomorrow") add({ label: msg("suggest.tomorrow"), query: "what about tomorrow" })
    if (f.range?.kind === "tomorrow") add({ label: msg("suggest.nextWeek"), query: "and next week" })
    if (intent !== "summary") add({ label: msg("suggest.summaryToday"), query: "summary for today" })
  }
  if (intent === "freeSlots" && f.range?.kind !== "tomorrow") add({ label: msg("suggest.tomorrow"), query: "what about tomorrow" })
  if (out.length < 3) add({ label: msg("suggest.today"), query: "appointments today" })
  if (out.length < 3) add({ label: msg("suggest.needsReview"), query: "appointments that need review" })
  if (out.length < 3) add({ label: msg("suggest.freeToday"), query: "free slots today" })
  if (out.length < 3 && f.range?.kind !== "today")
    add({ label: msg("suggest.followUps"), query: "follow-up appointments" })
  return out.slice(0, 4)
}

function starters(data: ScheduleData, c: Clock): Suggestion[] {
  // A real patient on today's list makes the example concrete.
  const today = select(data, { range: namedRange("today", c.today) })
  const example = data.patients.find((p) => p.id === (today.find((a) => a.status === "needsReview") ?? today[0])?.patientId)
  const out: Suggestion[] = [
    { label: msg("suggest.today"), query: "appointments today" },
    { label: msg("suggest.needsReview"), query: "appointments that need review" },
  ]
  if (example)
    out.push({ label: msg("suggest.nextFor", { name: firstName(example.name) }), query: `next appointment for ${example.name}` })
  out.push({ label: msg("suggest.summaryWeek"), query: "summary this week" })
  out.push({ label: msg("suggest.freeToday"), query: "free slots today" })
  out.push({ label: msg("suggest.followUps"), query: "follow-up appointments" })
  return out
}

// ── Answering ──────────────────────────────────────────────────────────────

function reply(
  text: Message[],
  blocks: ReplyBlock[],
  intent: Intent,
  filters: AppointmentFilters,
  data: ScheduleData,
  extra: Partial<AssistantReply> = {},
): AssistantReply {
  return { text, blocks, suggestions: suggestions(intent, filters, data), ...extra }
}

/**
 * Answers one question from the schedule. Pure and deterministic for a given
 * clock, so it is easy to test and to swap for a model later.
 */
export function answer(query: string, ctx: ConversationContext, data: ScheduleData, clock?: Clock): AssistantResponse {
  const c = clock ?? { today: todayIso(), minutes: nowMinutes() }
  const p: ParsedQuery = parseQuery(query, directory(data), c.today)
  const carried = p.followUp && hasFilters(ctx.filters)
  let filters: AppointmentFilters = carried ? mergeFilters(ctx.filters, p.filters) : { ...p.filters }

  const done = (r: AssistantReply, intent: Intent, ids: string[] = [], f = filters): AssistantResponse => {
    const patients = new Set(ids.map((id) => data.appointments.find((a) => a.id === id)?.patientId))
    const onlyPatient = patients.size === 1 ? [...patients][0] : undefined
    return {
      reply: r,
      context: {
        filters: f,
        lastIntent: intent,
        patientId: f.patientId ?? onlyPatient ?? ctx.patientId,
        appointmentIds: ids,
      },
    }
  }

  if (p.patientPronoun) {
    if (!ctx.patientId) return done(reply([msg("reply.whichPatient")], [], "unknown", {}, data), "unknown", [], ctx.filters)
    filters.patientId = ctx.patientId
  }

  let intent: Intent =
    p.intent ??
    (p.followUp && ctx.lastIntent && CARRIED_INTENTS.includes(ctx.lastIntent)
      ? ctx.lastIntent
      : hasFilters(p.filters) || p.aboutSchedule || p.patientPronoun
        ? "list"
        : "unknown")
  // "Tell me about Lakshmi" is a patient question; without a patient it is a list.
  if (intent === "patient" && !filters.patientId) intent = hasFilters(filters) ? "list" : "patient"

  switch (intent) {
    case "greeting":
      return done(reply([msg("reply.greeting")], [], intent, {}, data, { suggestions: starters(data, c).slice(0, 4) }), intent, [], ctx.filters)
    case "thanks":
      return done(reply([msg("reply.thanks")], [], intent, ctx.filters, data), intent, ctx.appointmentIds, ctx.filters)
    case "help":
      return done(reply([msg("reply.help")], [], intent, {}, data, { suggestions: starters(data, c) }), intent, [], ctx.filters)
    case "unknown":
      return done(reply([msg("reply.unknown")], [], intent, {}, data, { suggestions: starters(data, c).slice(0, 4) }), intent, [], ctx.filters)

    case "details": {
      const a = data.appointments.find((x) => x.id === p.appointmentId)
      if (!a) return done(reply([msg("reply.detailsUnknown", { id: p.appointmentId ?? "" })], [], intent, {}, data), intent)
      const f = { patientId: a.patientId }
      return done(
        reply([appointmentMessage("reply.details", a, data)], [{ type: "appointments", ids: [a.id] }], intent, f, data),
        intent,
        [a.id],
        f,
      )
    }

    case "calendar": {
      // Opens the Consultations calendar at the patient's appointment: in the dates
      // asked about, the next one still to come, else the most recent.
      const byId = p.appointmentId ? data.appointments.find((x) => x.id === p.appointmentId) : undefined
      if (p.appointmentId && !byId) return done(reply([msg("reply.detailsUnknown", { id: p.appointmentId })], [], intent, {}, data), intent)
      const patientId = byId?.patientId ?? filters.patientId
      if (!patientId) {
        // "Open the calendar" with no one named: just go there (on the day asked about, if any).
        const date = isSingleDay(p.filters.range) ? p.filters.range?.from : undefined
        return done(reply([msg("reply.calendarOpen")], [], intent, {}, data, { open: { page: "calendar", date } }), intent, [], ctx.filters)
      }
      const pick = (f: AppointmentFilters) => {
        const pool = select(data, f)
        return pool.find((a) => isUpcoming(a, c)) ?? pool.filter((a) => isPast(a, c)).at(-1) ?? pool[0]
      }
      const f: AppointmentFilters = { patientId }
      const hit = byId ?? pick({ patientId, range: p.filters.range }) ?? (p.filters.range ? pick(f) : undefined)
      if (!hit) {
        const name = data.patients.find((x) => x.id === patientId)?.name ?? patientId
        return done(reply([msg("reply.calendarNone", { name })], [], intent, f, data), intent, [], f)
      }
      return done(
        reply([appointmentMessage("reply.calendar", hit, data)], [{ type: "appointments", ids: [hit.id] }], intent, f, data, {
          open: { page: "calendar", appointmentId: hit.id },
        }),
        intent,
        [hit.id],
        f,
      )
    }

    case "patient": {
      const patient = data.patients.find((x) => x.id === filters.patientId)
      if (!patient) return done(reply([msg("reply.patientUnknown")], [], intent, {}, data), intent)
      const f = { patientId: patient.id }
      const all = select(data, f)
      const next = all.find((a) => isUpcoming(a, c))
      const text = [msg("reply.patient", { name: patient.name, age: patient.age, count: all.length })]
      if (next) text.push(appointmentMessage("reply.patientNext", next, data))
      return done(
        reply(
          text,
          [
            { type: "patient", patientId: patient.id, nextAppointmentId: next?.id, total: all.length },
            { type: "appointments", ids: all.map((a) => a.id) },
          ],
          intent,
          f,
          data,
        ),
        intent,
        all.map((a) => a.id),
        f,
      )
    }

    case "next":
    case "last": {
      const pool = select(data, filters)
      const hit = intent === "next" ? pool.find((a) => isUpcoming(a, c)) : pool.filter((a) => isPast(a, c)).at(-1)
      if (!hit)
        return done(reply([msg(intent === "next" ? "reply.nextNone" : "reply.lastNone")], [], intent, filters, data, { filters, carried }), intent)
      return done(
        reply([appointmentMessage(intent === "next" ? "reply.next" : "reply.last", hit, data)], [{ type: "appointments", ids: [hit.id] }], intent, filters, data, {
          filters,
          carried,
        }),
        intent,
        [hit.id],
      )
    }

    case "freeSlots": {
      const range = filters.range
      const date = range?.from && range.from >= c.today ? range.from : c.today
      filters = { ...filters, range: isSingleDay(range) ? range : dayRange(date), status: undefined }
      const doctors = data.doctors.filter(
        (d) => (!filters.doctorId || d.id === filters.doctorId) && (!filters.department || d.department === filters.department),
      )
      const rows = doctors.map((d) => ({ doctorId: d.id, slots: freeSlots(data, d.id, date, c) }))
      const open = rows.some((r) => r.slots.length > 0)
      return done(
        reply([msg(open ? "reply.slots" : "reply.slotsNone", { date: { date } })], [{ type: "slots", date, rows }], intent, filters, data, {
          filters: { ...filters, patientId: undefined },
          carried,
        }),
        intent,
        [],
        filters,
      )
    }

    case "summary":
    case "doctors": {
      if (!filters.range) filters = { ...filters, range: namedRange("today", c.today) }
      const list = select(data, filters)
      const ids = list.map((a) => a.id)
      if (intent === "doctors") {
        const counts = new Map<string, number>()
        for (const a of list) counts.set(a.doctorId, (counts.get(a.doctorId) ?? 0) + 1)
        const rows = [...counts].map(([doctorId, count]) => ({ doctorId, count })).sort((a, b) => b.count - a.count)
        return done(reply([msg("reply.doctors", { count: rows.length })], [{ type: "doctors", rows }], intent, filters, data, { filters, carried }), intent, ids)
      }
      const byStatus = Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, 0])) as Record<AppointmentStatus, number>
      for (const a of list) byStatus[a.status]++
      const text = [msg(list.length ? "reply.summary" : "reply.summaryNone", { count: list.length })]
      if (byStatus.needsReview) text.push(msg("reply.summaryReview", { count: byStatus.needsReview }))
      const upcoming = list.find((a) => isUpcoming(a, c))
      if (upcoming && list.length) text.push(appointmentMessage("reply.summaryNext", upcoming, data))
      const block: ReplyBlock = {
        type: "summary",
        total: list.length,
        patients: new Set(list.map((a) => a.patientId)).size,
        doctors: new Set(list.map((a) => a.doctorId)).size,
        byStatus,
      }
      return done(reply(text, [block], intent, filters, data, { filters, carried }), intent, ids)
    }

    case "list":
    case "count": {
      if (!hasFilters(filters)) filters = { range: namedRange("today", c.today) }
      let list = select(data, filters)
      let usedCarry = carried
      // A follow-up naming someone new that narrows to nothing probably started a new question.
      // Keep the dates we were talking about if that finds something, else take the question on its own.
      if (!list.length && carried && (p.filters.patientId || p.filters.doctorId || p.filters.department)) {
        const candidates: AppointmentFilters[] = [{ range: ctx.filters.range, ...p.filters }, { ...p.filters }]
        for (const candidate of candidates) {
          const fresh = select(data, candidate)
          if (fresh.length) {
            filters = candidate
            list = fresh
            usedCarry = candidate.range !== undefined && candidate.range === ctx.filters.range
            break
          }
        }
      }
      if (filters.range?.kind === "past") list = [...list].reverse()
      const ids = list.map((a) => a.id)
      const key = intent === "count" ? "reply.count" : list.length ? "reply.list" : "reply.listNone"
      return done(
        reply([msg(key, { count: list.length })], list.length ? [{ type: "appointments", ids }] : [], intent, filters, data, {
          filters,
          carried: usedCarry,
        }),
        intent,
        ids,
      )
    }
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * Answers on the device from the schedule `getData` returns (read on every
 * question, so status changes made in the chat show up in later answers).
 * `latencyMs` gives the reply a moment to arrive, like a real service.
 */
export function createLocalEngine(getData: () => ScheduleData, { latencyMs = 550 } = {}): AssistantEngine {
  return {
    async respond({ query, context }, signal) {
      await wait(latencyMs, signal)
      return answer(query, context, getData())
    },
    starters() {
      return starters(getData(), { today: todayIso(), minutes: nowMinutes() })
    },
  }
}

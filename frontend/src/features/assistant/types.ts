import type { AppointmentStatus, Department, SampleAppointment, SampleDoctor } from "@/data/appointments"
import type { SamplePatient } from "@/data/sample"

/** The schedule the assistant answers from (sample data today, the API later). */
export interface ScheduleData {
  appointments: SampleAppointment[]
  patients: SamplePatient[]
  doctors: SampleDoctor[]
}

export type DateRangeKind =
  | "today"
  | "tomorrow"
  | "yesterday"
  | "thisWeek"
  | "nextWeek"
  | "lastWeek"
  | "thisMonth"
  | "nextMonth"
  | "lastMonth"
  | "upcoming"
  | "past"
  | "nextDays"
  | "lastDays"
  | "day"

/** Inclusive ISO-date bounds (yyyy-mm-dd); an open end has no bound. */
export interface DateRange {
  kind: DateRangeKind
  from?: string
  to?: string
  /** For nextDays / lastDays. */
  days?: number
}

export interface AppointmentFilters {
  patientId?: string
  doctorId?: string
  department?: Department
  status?: AppointmentStatus[]
  language?: string
  range?: DateRange
}

export type Intent =
  | "list"
  | "count"
  | "next"
  | "last"
  | "summary"
  | "freeSlots"
  | "patient"
  | "doctors"
  | "details"
  | "help"
  | "greeting"
  | "thanks"
  | "unknown"

/**
 * A value inside a message. Dates and times stay raw so the UI formats them in
 * the doctor's interface language.
 */
export type MessageValue = string | number | { date: string } | { time: string }

/** A translatable message: an i18n key under `assistant.` plus its values. */
export interface Message {
  key: string
  values?: Record<string, MessageValue>
}

/** Plain text from a model or server that is already in the doctor's language. */
export interface PlainText {
  plain: string
}

/** A one-tap prompt: the label shown and the query sent to the engine. */
export interface Suggestion {
  label: Message
  query: string
}

export interface TimeSlot {
  start: string // HH:mm
  end: string // HH:mm
}

/** Structured content under a reply. Appointment rows are looked up by id, so they show the latest status. */
export type ReplyBlock =
  | { type: "appointments"; ids: string[] }
  | { type: "summary"; total: number; patients: number; doctors: number; byStatus: Record<AppointmentStatus, number> }
  | { type: "slots"; date: string; rows: { doctorId: string; slots: TimeSlot[] }[] }
  | { type: "patient"; patientId: string; nextAppointmentId?: string; total: number }
  | { type: "doctors"; rows: { doctorId: string; count: number }[] }

export interface AssistantReply {
  /** Paragraphs, in order. */
  text: (Message | PlainText)[]
  /** Filters the answer used, shown as chips so the doctor sees the context. */
  filters?: AppointmentFilters
  /** True when this answer built on the previous question's context. */
  carried?: boolean
  blocks: ReplyBlock[]
  suggestions: Suggestion[]
}

/** What the conversation remembers between turns (multi-turn context). */
export interface ConversationContext {
  filters: AppointmentFilters
  lastIntent?: Intent
  /** Who "he", "she" or "this patient" refers to. */
  patientId?: string
  /** The appointments in the last answer. */
  appointmentIds: string[]
}

export const EMPTY_CONTEXT: ConversationContext = { filters: {}, appointmentIds: [] }

export interface AssistantRequest {
  query: string
  context: ConversationContext
}

export interface AssistantResponse {
  reply: AssistantReply
  context: ConversationContext
}

/**
 * The one seam between the chat UI and whatever answers it. The local engine
 * answers from sample data on the device; a backend or LLM engine can replace
 * it without touching the UI.
 */
export interface AssistantEngine {
  respond(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse>
  /** Prompts for an empty conversation. */
  starters(): Suggestion[]
}

export type ChatMessage =
  | { id: string; role: "user"; text: string; at: number }
  | { id: string; role: "assistant"; reply: AssistantReply; at: number }
  | { id: string; role: "error"; query: string; at: number }

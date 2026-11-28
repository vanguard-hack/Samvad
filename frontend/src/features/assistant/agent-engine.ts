import type { SampleAppointment } from "@/data/appointments"
import { mergeAppointments } from "@/data/appointments-store"
import type { AssistantEngine, AssistantReply, Message, Suggestion } from "@/features/assistant/types"
import { api } from "@/lib/api"

/** POST /api/samvad-agent/query response (backend/app/schemas/samvad_agent.py: AgentQueryOut). */
interface AgentQueryOut {
  session_id: string
  response: string
  paragraphs: string[]
  appointment_ids: string[]
  appointments: SampleAppointment[]
  suggestions: string[]
}

const msg = (key: string): Message => ({ key })

/** Starters for an empty chat: what the assistant can do, as the doctor would ask it. */
const STARTERS: Suggestion[] = [
  { label: msg("suggest.today"), query: "What's on my schedule today?" },
  { label: msg("suggest.needsReview"), query: "Which appointments need my review?" },
  { label: msg("suggest.summaryWeek"), query: "Give me this week at a glance." },
  { label: msg("suggest.followUps"), query: "Which patients are due for a follow-up?" },
]

/**
 * The Samvad agent on the backend: it reads the doctor's schedule, patients and
 * meeting notes and answers in the interface language. The conversation's
 * history lives on the server under `sessionId`, kept in the chat context.
 */
export function createAgentEngine(language: () => string): AssistantEngine {
  return {
    async respond({ query, context }, signal) {
      const sessionId = context.sessionId ?? crypto.randomUUID()
      const res = await api("/samvad-agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, session_id: sessionId, language: language().split("-")[0] }),
        signal,
      })
      const out = (await res.json()) as AgentQueryOut
      // The cards look appointments up in the shared store, which the calendar uses too.
      mergeAppointments(out.appointments)

      const reply: AssistantReply = {
        text: out.paragraphs.map((plain) => ({ plain })),
        blocks: out.appointment_ids.length ? [{ type: "appointments", ids: out.appointment_ids }] : [],
        suggestions: out.suggestions.map((q) => ({ label: { plain: q }, query: q })),
      }
      return { reply, context: { ...context, sessionId, appointmentIds: out.appointment_ids } }
    },
    starters: () => STARTERS,
  }
}

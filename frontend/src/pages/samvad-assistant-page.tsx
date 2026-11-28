import { useReducedMotion } from "motion/react"
import { SquarePen } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import type { SampleDoctor } from "@/data/appointments"
import { setAppointmentStatus, useAppointments } from "@/data/appointments-store"
import { createAgentEngine } from "@/features/assistant/agent-engine"
import { claimShortcut } from "@/features/assistant/assistant-bus"
import { AssistantContext, type AssistantContextValue } from "@/features/assistant/assistant-context"
import { ChatComposer, type ComposerHandle } from "@/features/assistant/chat-composer"
import { AssistantMessage, ErrorMessage, ThinkingMessage, UserMessage } from "@/features/assistant/chat-message"
import { EmptyState } from "@/features/assistant/empty-state"
import type { ScheduleData, Suggestion } from "@/features/assistant/types"
import { useAssistantChat } from "@/features/assistant/use-assistant-chat"
import { useMessageText } from "@/features/assistant/use-message-text"
import { AppointmentDialog } from "@/features/consultations/appointment-dialog"
import { openCalendar } from "@/features/consultations/calendar-focus"

/** Focus the composer on arrival with a mouse or pen, not on touch screens where it would pop the keyboard. */
const FINE_POINTER = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches

export function SamvadAssistantPage() {
  const { t, i18n } = useTranslation()
  const { text } = useMessageText()
  const reduced = useReducedMotion()

  // Shared with the Consultations calendar; answers add the appointments they show.
  const appointments = useAppointments()
  const data = useMemo<ScheduleData>(() => {
    // Doctors as booked on the appointments (answer cards read them from here).
    const doctors = new Map<string, SampleDoctor>()
    for (const a of appointments) if (a.doctor) doctors.set(a.doctor.id, a.doctor)
    return { appointments, patients: [], doctors: [...doctors.values()] }
  }, [appointments])
  // Answers come from the Samvad agent on the backend, in the interface language.
  const language = useRef(i18n.language)
  language.current = i18n.language
  const engine = useMemo(() => createAgentEngine(() => language.current), [])
  const chat = useAssistantChat(engine)
  // Four starters keep the welcome screen on one page without scrolling.
  const starters = useMemo(() => engine.starters().slice(0, 4), [engine])

  const [openId, setOpenId] = useState<string | null>(null)
  const open = appointments.find((a) => a.id === openId) ?? null

  const composer = useRef<ComposerHandle>(null)
  const { send } = chat
  const pick = useCallback(
    (s: Suggestion) => {
      send(text(s.label), s.query)
      composer.current?.focus()
    },
    [send, text],
  )

  // Ctrl+Space on this page dictates into the prompt bar instead of opening the floating assistant.
  useEffect(() => claimShortcut(() => composer.current?.toggleVoice()), [])

  // "Put up Lakshmi's appointment details": after a moment to read the reply, go to the calendar at it.
  // Only for replies made now, not ones restored from earlier in the session.
  const navigate = useNavigate()
  const latest = chat.messages.at(-1)
  const handledOpen = useRef<string | null>(null)
  useEffect(() => {
    if (latest?.role !== "assistant" || !latest.reply.open || latest.at < chat.openedAt || handledOpen.current === latest.id) return
    handledOpen.current = latest.id
    const { appointmentId, date } = latest.reply.open
    const timer = window.setTimeout(() => openCalendar(navigate, { appointmentId, date }), 900)
    return () => window.clearTimeout(timer)
  }, [latest, chat.openedAt, navigate])

  const value = useMemo<AssistantContextValue>(
    () => ({ data, openAppointment: setOpenId, ask: send, pending: chat.pending }),
    [data, send, chat.pending],
  )

  // Keep the newest message in view.
  const end = useRef<HTMLDivElement>(null)
  const count = chat.messages.length
  useEffect(() => {
    if (count === 0 && !chat.pending) return // the welcome screen starts at the top
    end.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" })
  }, [count, chat.pending, reduced])

  const lastAssistant = chat.messages.findLastIndex((m) => m.role === "assistant")
  const empty = count === 0 && !chat.pending

  return (
    <AssistantContext.Provider value={value}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-base font-semibold">{t("assistant.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("assistant.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="xs"
            disabled={count === 0}
            onClick={() => {
              chat.reset()
              composer.current?.focus()
            }}
          >
            <SquarePen />
            {t("assistant.newChat")}
          </Button>
        </div>

        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t("assistant.conversation")}
          className="min-h-0 flex-1 overflow-y-auto px-4"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-2">
            {empty && <EmptyState starters={starters} onPick={pick} />}
            {chat.messages.map((m, i) => {
              const animate = m.at >= chat.openedAt
              if (m.role === "user") return <UserMessage key={m.id} text={m.text} at={m.at} animate={animate} />
              if (m.role === "error")
                return <ErrorMessage key={m.id} onRetry={() => chat.retry(m.id)} disabled={chat.pending} />
              return (
                <AssistantMessage
                  key={m.id}
                  reply={m.reply}
                  at={m.at}
                  animate={animate}
                  latest={i === lastAssistant && i === count - 1}
                  pending={chat.pending}
                  onPick={pick}
                />
              )
            })}
            {chat.pending && <ThinkingMessage />}
            <div ref={end} />
          </div>
        </div>

        <div className="px-4 pt-1 pb-3">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
            <ChatComposer
              ref={composer}
              onSend={send}
              onStop={chat.stop}
              pending={chat.pending}
              autoFocus={FINE_POINTER}
            />
          </div>
        </div>
      </div>

      <AppointmentDialog appointment={open} onOpenChange={(next) => !next && setOpenId(null)} onStatusChange={setAppointmentStatus} />
    </AssistantContext.Provider>
  )
}

import { useReducedMotion } from "motion/react"
import { SquarePen } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SAMPLE_APPOINTMENTS, SAMPLE_DOCTORS, type AppointmentStatus } from "@/data/appointments"
import { SAMPLE_PATIENTS } from "@/data/sample"
import { AssistantContext, type AssistantContextValue } from "@/features/assistant/assistant-context"
import { ChatComposer, type ComposerHandle } from "@/features/assistant/chat-composer"
import { AssistantMessage, ErrorMessage, ThinkingMessage, UserMessage } from "@/features/assistant/chat-message"
import { EmptyState } from "@/features/assistant/empty-state"
import { createLocalEngine } from "@/features/assistant/local-engine"
import type { ScheduleData, Suggestion } from "@/features/assistant/types"
import { useAssistantChat } from "@/features/assistant/use-assistant-chat"
import { useMessageText } from "@/features/assistant/use-message-text"
import { AppointmentDialog } from "@/features/consultations/appointment-dialog"

/** Focus the composer on arrival with a mouse or pen, not on touch screens where it would pop the keyboard. */
const FINE_POINTER = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches

export function SamvadAssistantPage() {
  const { t } = useTranslation()
  const { text } = useMessageText()
  const reduced = useReducedMotion()

  // Sample data held in memory only: status changes vanish on reload (no backend yet).
  const [appointments, setAppointments] = useState(SAMPLE_APPOINTMENTS)
  const data = useMemo<ScheduleData>(() => ({ appointments, patients: SAMPLE_PATIENTS, doctors: SAMPLE_DOCTORS }), [appointments])
  // A status changed in the dialog is in every later answer.
  const engine = useMemo(() => createLocalEngine(() => data), [data])
  const chat = useAssistantChat(engine)
  const starters = useMemo(() => engine.starters(), [engine])

  const [openId, setOpenId] = useState<string | null>(null)
  const open = appointments.find((a) => a.id === openId) ?? null
  const setStatus = (id: string, status: AppointmentStatus) =>
    setAppointments((list) => list.map((a) => (a.id === id ? { ...a, status } : a)))

  const composer = useRef<ComposerHandle>(null)
  const { send } = chat
  const pick = useCallback(
    (s: Suggestion) => {
      send(text(s.label), s.query)
      composer.current?.focus()
    },
    [send, text],
  )

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
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              {t("assistant.title")}
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" className="font-normal text-muted-foreground" />}>
                  {t("assistant.sampleData")}
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{t("assistant.sampleDataHint")}</TooltipContent>
              </Tooltip>
            </h1>
            <p className="text-sm text-muted-foreground">{t("assistant.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
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
          className="min-h-0 flex-1 overflow-y-auto px-5"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-4">
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

        <div className="px-5 pt-2 pb-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
            <ChatComposer ref={composer} onSend={send} onStop={chat.stop} pending={chat.pending} autoFocus={FINE_POINTER} />
            <p className="text-center text-[11px] text-muted-foreground">{t("assistant.disclaimer")}</p>
          </div>
        </div>
      </div>

      <AppointmentDialog appointment={open} onOpenChange={(next) => !next && setOpenId(null)} onStatusChange={setStatus} />
    </AssistantContext.Provider>
  )
}

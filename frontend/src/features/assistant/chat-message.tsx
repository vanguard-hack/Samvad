import { motion, useReducedMotion } from "motion/react"
import { CircleAlert, CornerDownRight, RotateCcw, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { AssistantOrb } from "@/features/assistant/assistant-orb"
import { FilterChips, ReplyBlockView } from "@/features/assistant/reply-blocks"
import { RevealText } from "@/features/assistant/reveal-text"
import type { AssistantReply, Suggestion } from "@/features/assistant/types"
import { useMessageText } from "@/features/assistant/use-message-text"
import { EASE_OUT } from "@/lib/ease"
import { formatClock } from "@/lib/format"

function useEnter(animate: boolean, from: "start" | "end" = "start") {
  const reduced = useReducedMotion()
  if (!animate || reduced) return {}
  return {
    initial: { opacity: 0, y: 10, x: from === "end" ? 8 : 0, scale: 0.98 },
    animate: { opacity: 1, y: 0, x: 0, scale: 1 },
    transition: { duration: 0.4, ease: EASE_OUT },
  }
}

function Time({ at }: { at: number }) {
  const { i18n } = useTranslation()
  const d = new Date(at)
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  return (
    <time dateTime={d.toISOString()} className="text-[11px] text-muted-foreground tabular-nums">
      {formatClock(hhmm, i18n.language)}
    </time>
  )
}

export function UserMessage({ text, at, animate }: { text: string; at: number; animate: boolean }) {
  const { t } = useTranslation()
  const enter = useEnter(animate, "end")
  return (
    <motion.div {...enter} className="flex flex-col items-end gap-1 ps-10">
      <span className="sr-only">{t("assistant.you")}</span>
      <p className="max-w-full rounded-2xl rounded-ee-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap break-words text-primary-foreground shadow-xs">
        {text}
      </p>
      <Time at={at} />
    </motion.div>
  )
}

function Suggestions({ items, onPick, disabled }: { items: Suggestion[]; onPick: (s: Suggestion) => void; disabled: boolean }) {
  const { text } = useMessageText()
  const reduced = useReducedMotion()
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s, i) => (
        <motion.button
          key={s.query}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s)}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT, delay: reduced ? 0 : 0.45 + i * 0.06 }}
          className="group inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          <Sparkles className="size-3 text-muted-foreground transition-colors group-hover:text-primary" />
          {text(s.label)}
        </motion.button>
      ))}
    </div>
  )
}

type AssistantMessageProps = {
  reply: AssistantReply
  at: number
  animate: boolean
  /** Only the latest answer offers follow-up suggestions. */
  latest: boolean
  pending: boolean
  onPick: (s: Suggestion) => void
}

export function AssistantMessage({ reply, at, animate, latest, pending, onPick }: AssistantMessageProps) {
  const { t } = useTranslation()
  const { text } = useMessageText()
  const enter = useEnter(animate)

  return (
    <motion.article {...enter} className="flex gap-3 pe-2">
      <AssistantOrb className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="sr-only">{t("assistant.name")}</span>
        {reply.carried && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownRight className="size-3 rtl:-scale-x-100" />
            {t("assistant.carried")}
          </p>
        )}
        <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
          {reply.text.map((m, i) => (
            <p key={i}>
              <RevealText text={text(m)} animate={animate} delay={i * 0.25} />
            </p>
          ))}
        </div>
        {reply.filters && <FilterChips filters={reply.filters} />}
        {reply.blocks.map((b, i) => (
          <ReplyBlockView key={`${b.type}-${i}`} block={b} />
        ))}
        {latest && reply.suggestions.length > 0 && <Suggestions items={reply.suggestions} onPick={onPick} disabled={pending} />}
        <Time at={at} />
      </div>
    </motion.article>
  )
}

export function ErrorMessage({ onRetry, disabled }: { onRetry: () => void; disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
        <CircleAlert className="size-4" />
      </span>
      <div className="flex flex-col items-start gap-2 pt-1 text-sm">
        <p>{t("assistant.error")}</p>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled}>
          <RotateCcw />
          {t("assistant.retry")}
        </Button>
      </div>
    </div>
  )
}

/** Shown while the answer is on its way. */
export function ThinkingMessage() {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="flex items-center gap-3"
      role="status"
    >
      <AssistantOrb thinking />
      <div className="flex items-center gap-2 rounded-2xl rounded-es-md border bg-card px-3 py-2 shadow-xs">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-muted-foreground"
              animate={reduced ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
            />
          ))}
        </span>
        <span className="animate-shimmer bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-size-[200%_100%] bg-clip-text text-xs text-transparent">
          {t("assistant.thinking")}
        </span>
      </div>
    </motion.div>
  )
}

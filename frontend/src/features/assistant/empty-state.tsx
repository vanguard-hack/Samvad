import { motion, useReducedMotion } from "motion/react"
import {
  ArrowUpRight,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  Clock3,
  Repeat2,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useAuth } from "@/auth/auth-provider"
import { displayName } from "@/auth/display-name"
import { AssistantOrb } from "@/features/assistant/assistant-orb"
import type { Suggestion } from "@/features/assistant/types"
import { useMessageText } from "@/features/assistant/use-message-text"
import { EASE_OUT } from "@/lib/ease"

const STARTER_ICONS: Record<string, LucideIcon> = {
  "suggest.today": CalendarClock,
  "suggest.needsReview": ClipboardCheck,
  "suggest.nextFor": UserRoundSearch,
  "suggest.summaryWeek": ChartColumn,
  "suggest.freeToday": Clock3,
  "suggest.followUps": Repeat2,
}

function greetingKey(hour = new Date().getHours()) {
  if (hour < 12) return "morning"
  if (hour < 17) return "afternoon"
  return "evening"
}

export function EmptyState({ starters, onPick }: { starters: Suggestion[]; onPick: (s: Suggestion) => void }) {
  const { t } = useTranslation()
  const { text } = useMessageText()
  const { user } = useAuth()
  const reduced = useReducedMotion()
  const name = displayName(user)
  const first = name === "—" ? "" : name.split(" ")[0]

  const rise = (delay: number) =>
    reduced
      ? {}
      : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: EASE_OUT, delay } }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-2 text-center sm:py-4">
      <motion.div
        initial={reduced ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
      >
        <AssistantOrb size="md" />
      </motion.div>

      <motion.div {...rise(0.1)} className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {first ? t(`assistant.empty.greeting.${greetingKey()}`, { name: first }) : t(`assistant.empty.greetingAnon.${greetingKey()}`)}
        </p>
        <h2 className="text-xl font-semibold tracking-display text-balance">{t("assistant.empty.title")}</h2>
        <p className="mx-auto max-w-md text-xs text-balance text-muted-foreground">{t("assistant.empty.body")}</p>
      </motion.div>

      <div className="grid w-full gap-2 sm:grid-cols-2">
        {starters.map((s, i) => {
          const Icon = ("key" in s.label ? STARTER_ICONS[s.label.key] : undefined) ?? CalendarClock
          return (
            <motion.button
              key={s.query}
              type="button"
              onClick={() => onPick(s)}
              {...rise(0.2 + i * 0.06)}
              className="group flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-start shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/30 hover:shadow-md"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{text(s.label)}</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

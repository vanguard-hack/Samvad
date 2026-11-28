import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { todayIso, addDays } from "@/features/assistant/dates"
import type { DateRange, Message, MessageValue, PlainText } from "@/features/assistant/types"
import { formatClock, formatWeekdayDate } from "@/lib/format"

/** Turns engine messages, dates and ranges into text in the doctor's interface language. */
export function useMessageText() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language

  /** "today", "tomorrow", or "Fri, 4 Dec" for use inside a sentence. */
  const day = useCallback(
    (iso: string) => {
      const today = todayIso()
      if (iso === today) return t("assistant.when.today")
      if (iso === addDays(today, 1)) return t("assistant.when.tomorrow")
      if (iso === addDays(today, -1)) return t("assistant.when.yesterday")
      return formatWeekdayDate(iso, lng)
    },
    [t, lng],
  )

  const value = useCallback(
    (v: MessageValue) => {
      if (typeof v !== "object") return v
      return "date" in v ? day(v.date) : formatClock(v.time, lng)
    },
    [day, lng],
  )

  const text = useCallback(
    (m: Message | PlainText) => {
      if ("plain" in m) return m.plain
      const values = Object.fromEntries(Object.entries(m.values ?? {}).map(([k, v]) => [k, value(v)]))
      return t(`assistant.${m.key}`, values)
    },
    [t, value],
  )

  const range = useCallback(
    (r: DateRange) => {
      if (r.kind === "day" && r.from) return formatWeekdayDate(r.from, lng)
      if (r.kind === "nextDays" || r.kind === "lastDays") return t(`assistant.range.${r.kind}`, { count: r.days ?? 0 })
      return t(`assistant.range.${r.kind}`)
    },
    [t, lng],
  )

  return { text, range, day }
}

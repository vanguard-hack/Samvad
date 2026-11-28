import { BorderBeam } from "border-beam"
import { ArrowUp, Mic, Square } from "lucide-react"
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useChatDictation } from "./use-chat-dictation"

const MAX_LENGTH = 500

/** Typed text with the spoken words appended (as in Sentinel's composer). */
function composeDictated(existing: string, final: string, interim: string) {
  const base = existing.replace(/\s+$/, "")
  const spoken = [final, interim]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim()
  if (!spoken) return base
  return base ? `${base} ${spoken}` : spoken
}

function useIsDark() {
  const { theme } = useTheme()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return theme === "dark" || (theme === "system" && systemDark)
}

export interface ComposerHandle {
  focus: () => void
  /** Start / stop dictation (the page's Ctrl+Space). */
  toggleVoice: () => void
}

type Props = {
  onSend: (text: string) => void
  onStop: () => void
  pending: boolean
  autoFocus?: boolean
  ref?: Ref<ComposerHandle>
}

/**
 * The Samvad Assistant prompt bar.
 * - Beam from libraries.dev (`border-beam`), exactly as its docs show: always
 *   running with fixed props. Toggling `active` (or changing props) makes it
 *   fade out and back in, which reads as flicker, so nothing here changes it.
 * - Dictation appends the spoken words to whatever was typed; nothing is sent
 *   until the doctor sends it.
 */
export function ChatComposer({ onSend, onStop, pending, autoFocus, ref }: Props) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const [value, setValue] = useState("")
  const area = useRef<HTMLTextAreaElement>(null)
  // What was typed, held while dictation appends to it, so speaking after
  // typing half a question doesn't overwrite the typed half.
  const typed = useRef("")

  const dictation = useChatDictation({
    onInterim: (interim) => setValue(composeDictated(typed.current, "", interim).slice(0, MAX_LENGTH)),
    onFinal: (final) => {
      typed.current = composeDictated(typed.current, final, "").slice(0, MAX_LENGTH)
      setValue(typed.current)
    },
    onEnd: () => area.current?.focus(),
  })
  const { listening, toggle, stop: stopDictation } = dictation

  const toggleVoice = () => {
    if (!listening) typed.current = value
    toggle()
  }
  const toggleRef = useRef(toggleVoice)
  useEffect(() => {
    toggleRef.current = toggleVoice
  })

  useImperativeHandle(
    ref,
    () => ({
      focus: () => area.current?.focus(),
      toggleVoice: () => toggleRef.current(),
    }),
    [],
  )

  // Grow with the text up to the max height, then scroll.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const submit = () => {
    if (pending || !value.trim()) return
    stopDictation() // sending ends dictation; the question has gone
    onSend(value)
    setValue("")
    typed.current = ""
  }

  return (
    <BorderBeam size="md" colorVariant="colorful" strength={0.7} theme={isDark ? "dark" : "light"}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="relative rounded-2xl border bg-card shadow-sm"
      >
        <textarea
          ref={area}
          rows={1}
          value={value}
          maxLength={MAX_LENGTH}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value)
            // A correction typed mid-dictation becomes the base the next words append to.
            if (listening) typed.current = e.target.value
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line; never interrupt an IME composition.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          aria-label={t("assistant.composer.label")}
          placeholder={t("assistant.composer.placeholder")}
          className="block max-h-32 min-h-10 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
          {/* Says the microphone is open; the words themselves are already in the bar. */}
          {listening ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
              {t("assistant.composer.listening")}
            </span>
          ) : dictation.error ? (
            <span className="text-xs text-destructive">{t("assistant.composer.voiceError")}</span>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-1.5">
            {value.length > MAX_LENGTH * 0.8 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {value.length}/{MAX_LENGTH}
              </span>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={cn(
                "rounded-full",
                listening && "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
              )}
              onClick={toggleVoice}
              aria-pressed={listening}
              title={listening ? t("assistant.composer.voiceStop") : t("assistant.composer.voice")}
            >
              <Mic />
              <span className="sr-only">{listening ? t("assistant.composer.voiceStop") : t("assistant.composer.voice")}</span>
            </Button>
            {pending ? (
              <Button type="button" size="icon-sm" variant="secondary" className="rounded-full" onClick={onStop}>
                <Square className="size-3 fill-current" />
                <span className="sr-only">{t("assistant.composer.stop")}</span>
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" className="rounded-full" disabled={!value.trim()}>
                <ArrowUp />
                <span className="sr-only">{t("assistant.composer.send")}</span>
              </Button>
            )}
          </span>
        </div>
      </form>
    </BorderBeam>
  )
}

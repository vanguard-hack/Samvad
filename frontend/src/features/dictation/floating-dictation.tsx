import { motion, useMotionValue, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { XIcon } from "lucide-react"
import { useLocation } from "react-router"
import { useMicrophone } from "voice-glow"

import { LiveOrb } from "@/features/interpreter/live-orb"
import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { useLiveTranscription } from "@/features/speech/use-live-transcription"
import { cn } from "@/lib/utils"

const POS_KEY = "samvad.dictation.pos"

/** Ctrl+Space toggles dictation (Fn and Ctrl+Tab never reach a web page). */
function isDictationShortcut(e: KeyboardEvent) {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "Space"
}

function savedPosition() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as { x: number; y: number } | null
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement

/** The text field the doctor was in when dictation started, if any. */
function editableTarget(): Editable | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement && /^(text|search|email|url|tel|)$/.test(el.type) && !el.readOnly) return el
  if (el.isContentEditable) return el
  return null
}

/** Inserts text at the caret in a way React's controlled inputs notice. */
function insertText(el: Editable, text: string) {
  if (!el.isConnected) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value.slice(0, start)
    const piece = (before && !/\s$/.test(before) ? " " : "") + text
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, before + piece + el.value.slice(end))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    const caret = start + piece.length
    el.setSelectionRange?.(caret, caret)
    return true
  }
  el.focus()
  return document.execCommand("insertText", false, ` ${text}`)
}

/**
 * Dictation mode on every page: Ctrl+Space shows a small voice orb (icon only)
 * that can be dragged anywhere. What the doctor says is transcribed live by
 * Sarvam (through the Samvad backend) and typed into the field they were in.
 * With no field selected, the text appears in a small bubble by the orb.
 * Clicking the orb, Escape, or Ctrl+Space again ends dictation.
 *
 * Dictated text is a draft: it is only typed into the field, and the doctor
 * still reviews and approves whatever that field feeds (Critical Rule 1).
 */
export function FloatingDictation() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const mic = useMicrophone()
  const [on, setOn] = useState(false)
  const [heard, setHeard] = useState("")
  const target = useRef<Editable | null>(null)
  const micLive = mic.state === "live"
  const level = useMicLevel(on && micLive ? mic.stream : null)

  const transcription = useLiveTranscription({
    language: "auto",
    mode: "codemix",
    onFinal: (text) => {
      if (target.current && insertText(target.current, text)) return
      setHeard((h) => (h ? `${h} ${text}` : text))
    },
  })
  const failed =
    mic.state === "denied" || mic.state === "unsupported" || mic.state === "error" || transcription.state === "error"

  const [initial] = useState(savedPosition)
  const x = useMotionValue(initial.x)
  const y = useMotionValue(initial.y)
  const bounds = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)

  const { start: micStart, stop: micStop } = mic
  const { start: liveStart, stop: liveStop } = transcription
  const toggle = useCallback(
    (next: boolean) => {
      setOn(next)
      if (next) {
        target.current = editableTarget()
        setHeard("")
        // From the key press, so the browser allows the microphone.
        void micStart().then((stream) => stream && liveStart(stream))
      } else {
        liveStop()
        micStop()
      }
    },
    [micStart, micStop, liveStart, liveStop],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDictationShortcut(e)) {
        e.preventDefault()
        toggle(!on)
      } else if (on && e.key === "Escape") {
        toggle(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, toggle])

  // The interpreter page has its own microphone; don't hold two at once.
  useEffect(() => {
    if (on && pathname === "/interpreter") toggle(false)
  }, [on, pathname, toggle])

  useEffect(() => () => micStop(), [micStop])

  if (!on && !heard) return null

  const status = failed
    ? transcription.state === "error"
      ? t("dictation.unavailable")
      : t(`interpreter.status.${mic.state}`)
    : transcription.state === "listening"
      ? t("dictation.listening")
      : t("interpreter.status.connecting")

  return (
    <div ref={bounds} className="pointer-events-none fixed inset-3 z-50">
      <motion.div
        drag
        dragConstraints={bounds}
        dragMomentum={false}
        dragElastic={0}
        style={{ x, y }}
        onPointerDown={() => (dragged.current = false)}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={() => localStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }))}
        className="pointer-events-auto absolute end-6 bottom-6 flex touch-none flex-col items-end gap-2"
      >
        {heard && (
          <div className="relative w-64 rounded-lg border bg-popover p-3 pe-8 text-sm text-popover-foreground shadow-lg">
            <p className="max-h-40 overflow-y-auto break-words select-text">{heard}</p>
            <button
              type="button"
              onClick={() => setHeard("")}
              aria-label={t("dictation.clear")}
              className="absolute top-2 end-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        {on && (
          <motion.button
            type="button"
            initial={reduced ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => {
              if (!dragged.current) toggle(false)
            }}
            aria-label={`${status}. ${t("dictation.stop")}`}
            title={`${status} · ${t("dictation.stop")}`}
            className={cn(
              // Just the orb, like ChatGPT: no frame, so it can swell freely past its box.
              "size-20 cursor-grab rounded-full outline-none drop-shadow-lg focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
            )}
          >
            <LiveOrb level={level} className="size-full" />
          </motion.button>
        )}
      </motion.div>
      <p role="status" aria-live="polite" className="sr-only">
        {on ? status : ""}
      </p>
    </div>
  )
}

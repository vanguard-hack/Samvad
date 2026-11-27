import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { useMicrophone } from "voice-glow"

import { VoiceOrb } from "@/components/agents/voice-orb"
import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { cn } from "@/lib/utils"

/** Same Samvad blue as the interpreter orb: base, highlight, shadow. */
const ORB_COLORS = ["#3f7be0", "#cfe2ff", "#16336e"] as const
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

/**
 * Dictation mode on every page: the shortcut shows a small voice orb (icon only)
 * that listens to the microphone and can be dragged anywhere on screen.
 * Clicking it, Escape, or the shortcut again ends dictation.
 *
 * No speech-to-text is connected yet, so it only shows that it is listening; it
 * never shows or inserts text. Audio is measured in the browser and not sent.
 */
export function FloatingDictation() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const mic = useMicrophone()
  const [on, setOn] = useState(false)
  const live = mic.state === "live"
  const failed = mic.state === "denied" || mic.state === "unsupported" || mic.state === "error"
  const level = useMicLevel(on && live ? mic.stream : null)
  const swell = useSpring(level, { stiffness: 260, damping: 18, mass: 0.6 })
  const scale = useTransform(swell, (v) => 1 + Math.min(1, v) * 0.22)

  const start = useRef(savedPosition())
  const x = useMotionValue(start.current.x)
  const y = useMotionValue(start.current.y)
  const bounds = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)

  const { start: micStart, stop: micStop } = mic
  const toggle = useCallback(
    (next: boolean) => {
      setOn(next)
      if (next) void micStart() // from the key press, so the browser allows the microphone
      else micStop()
    },
    [micStart, micStop],
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

  if (!on) return null

  const status = failed
    ? t(`interpreter.status.${mic.state}`)
    : live
      ? t("dictation.listening")
      : t("interpreter.status.connecting")

  return (
    <div ref={bounds} className="pointer-events-none fixed inset-3 z-50">
      <motion.button
        type="button"
        drag
        dragConstraints={bounds}
        dragMomentum={false}
        dragElastic={0}
        style={{ x, y }}
        initial={reduced ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        onPointerDown={() => (dragged.current = false)}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={() => localStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }))}
        onClick={() => {
          if (!dragged.current) toggle(false)
        }}
        aria-label={`${status}. ${t("dictation.stop")}`}
        title={`${status} · ${t("dictation.stop")}`}
        className={cn(
          "pointer-events-auto absolute end-6 bottom-6 size-16 cursor-grab touch-none rounded-full bg-background p-1 shadow-lg ring-1 ring-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
          failed && "ring-2 ring-destructive",
        )}
      >
        <motion.div style={{ scale: reduced ? 1 : scale }} className="size-full">
          <VoiceOrb colors={ORB_COLORS} activity={level} active={!failed} aria-hidden="true" className="size-full" />
        </motion.div>
      </motion.button>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  )
}

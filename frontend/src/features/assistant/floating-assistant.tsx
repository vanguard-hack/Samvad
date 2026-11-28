import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { MessagesSquare, Square, XIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { LiveOrb } from "@/features/interpreter/live-orb"
import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { listenOnce } from "@/features/speech/listen-once"
import { usePlayback } from "@/features/speech/use-playback"
import { getLanguage } from "@/i18n/languages"
import { api, fromSarvamCode, speak } from "@/lib/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { emitPageAction, runClaimedShortcut, type AssistantAction } from "./assistant-bus"
import { ConversationRecorder } from "./conversations-api"

const POS_KEY = "samvad.dictation.pos"
const MAX_HISTORY = 10
/** End the conversation after this much silence. */
const SILENCE_MS = 25000

/**
 * Echo guard for barge-in: if what the microphone "heard" while Samvad was
 * speaking is mostly words of Samvad's own reply, it's the speakers leaking
 * through, not the doctor interrupting.
 */
function looksLikeEcho(partial: string, speaking: string) {
  if (!speaking) return false
  const words = (text: string) => text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)
  const heard = words(partial)
  if (heard.length === 0) return true
  const said = new Set(words(speaking))
  return heard.filter((w) => said.has(w)).length / heard.length >= 0.6
}

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error"
type Turn = { role: "user" | "assistant"; text: string }
type Reply = { reply: string; actions: AssistantAction[]; ended: boolean }

/** Ctrl+Space toggles the assistant (Fn and Ctrl+Tab never reach a web page). */
function isShortcut(e: KeyboardEvent) {
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
 * Global voice assistant. Ctrl+Space shows a draggable voice orb; the doctor
 * speaks, Sarvam transcribes, Claude (via the Samvad backend) answers and can
 * open pages, filter the queue, look up and save patients, or start a voice
 * registration. The reply is spoken back, then it listens again, until the
 * doctor stops it (click the orb, Esc, Ctrl+Space) or stays silent.
 *
 * Each opening is one session: every question and reply is saved to Supabase
 * (doctor-only) and can be read back as a chat on the Conversations page.
 * Clicking the orb opens a menu to view conversations or end this one.
 */
export function FloatingAssistant() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [heard, setHeard] = useState("")
  const [reply, setReply] = useState("")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const history = useRef<Turn[]>([])
  const recorder = useRef<ConversationRecorder | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  const playback = usePlayback()
  const micLevel = useMicLevel(on ? stream : null)
  const level = useTransform([micLevel, playback.level], ([a, b]: number[]) => Math.max(a, b))

  const [initial] = useState(savedPosition)
  const x = useMotionValue(initial.x)
  const y = useMotionValue(initial.y)
  const bounds = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)

  const { play, stop: stopPlayback } = playback

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    recorder.current?.end() // closing the assistant ends the session
    recorder.current = null
    setMenuOpen(false)
    stopPlayback()
    setStream((s) => {
      s?.getTracks().forEach((tr) => tr.stop())
      return null
    })
    setOn(false)
    setPhase("idle")
  }, [stopPlayback])

  const perform = useCallback(
    (action: AssistantAction) => {
      if (action.type === "navigate") {
        const to =
          action.page === "patient" && action.patient_id
            ? `/patients/${action.patient_id}`
            : action.page === "patients"
              ? "/"
              : `/${action.page}`
        navigate(to)
        return
      }
      // Queue actions belong to the patients page (home): open it first if needed.
      if (action.type !== "refresh" && pathRef.current !== "/") navigate("/")
      emitPageAction(action)
    },
    [navigate],
  )

  const start = useCallback(async () => {
    stop()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const { signal } = ctrl
    setOn(true)
    setHeard("")
    setReply("")
    setPhase("listening")
    history.current = [] // a new opening is a new session
    const log = new ConversationRecorder()
    recorder.current = log
    let mic: MediaStream | null = null
    try {
      // Echo cancellation on, so the spoken reply isn't heard as the next question.
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (signal.aborted) return
      setStream(mic)

      // Always listening: the next question is picked up while Samvad is still
      // thinking or speaking, and speaking over it interrupts (barge-in).
      let interruptHandler: ((partial: string) => void) | null = null
      const listen = () => {
        const heard = listenOnce({
          stream: mic!,
          language: "auto",
          signal,
          timeoutMs: SILENCE_MS,
          onPartial: (partial) => {
            setHeard(partial)
            if (partial.trim()) interruptHandler?.(partial)
          },
        })
        heard.catch(() => {}) // awaited below; avoid an unhandled rejection if the session stops first
        return heard
      }

      let nextQuestion = listen()
      for (;;) {
        setPhase("listening")
        const said = await nextQuestion
        if (signal.aborted) return
        if (!said) break // silence ends the conversation
        setHeard(said.text)
        setPhase("thinking")
        const language = fromSarvamCode(said.language) ?? "en"
        log.add("user", said.text, language)

        // One request per question; an interruption cancels it.
        const request = new AbortController()
        const cancel = () => request.abort()
        signal.addEventListener("abort", cancel)
        let interrupted = false
        let speaking = ""
        interruptHandler = (partial) => {
          if (interrupted || looksLikeEcho(partial, speaking)) return
          interrupted = true
          request.abort()
          stopPlayback()
          setPhase("listening")
        }
        nextQuestion = listen() // start listening for the next question right away

        try {
          const page = document.getElementById("main")?.innerText ?? ""
          let out: Reply
          try {
            const res = await api("/assistant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: said.text,
                language,
                path: pathRef.current,
                page_text: page.replace(/\s+\n/g, "\n").slice(0, 5000),
                history: history.current,
              }),
              signal: request.signal,
            })
            out = (await res.json()) as Reply
          } catch (err) {
            if (interrupted && (err as Error).name === "AbortError") continue // the new question takes over
            throw err
          }
          if (signal.aborted) return
          history.current = [...history.current, { role: "user" as const, text: said.text }, { role: "assistant" as const, text: out.reply }].slice(
            -MAX_HISTORY,
          )
          out.actions.forEach(perform)
          setReply(out.reply)
          if (out.ended || interrupted) {
            log.add("assistant", out.reply, language, interrupted)
            if (out.ended) break // e.g. a voice registration took over the microphone
            continue
          }

          // Speak the reply in the doctor's language when Samvad has a voice for it.
          const voiceLang = getLanguage(language).voice ? language : "en"
          try {
            const audio = await speak(out.reply, voiceLang)
            if (!interrupted && !signal.aborted) {
              speaking = out.reply
              setPhase("speaking")
              await play(audio) // returns early if the doctor interrupts
            }
          } catch {
            /* the reply is still shown */
          }
          log.add("assistant", out.reply, language, interrupted) // interrupted = cut off while speaking
          if (signal.aborted) return
        } finally {
          signal.removeEventListener("abort", cancel)
        }
      }
      stop()
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      setPhase("error")
      setReply(t("assistant.error"))
      mic?.getTracks().forEach((tr) => tr.stop())
      setStream(null)
    }
  }, [perform, play, stop, stopPlayback, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e)) {
        e.preventDefault()
        if (on) stop()
        else if (runClaimedShortcut()) return // e.g. the New patient form's voice questions
        else void start() // from the key press, so the browser allows the microphone
      } else if (on && e.key === "Escape") {
        stop()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, start, stop])

  // The interpreter page has its own microphone; don't hold two at once.
  useEffect(() => {
    if (on && pathname === "/interpreter") stop()
  }, [on, pathname, stop])

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!on && phase !== "error") return null

  const status = t(`assistant.phase.${phase}`)
  const bubble = phase === "listening" ? heard : reply || heard

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
        {bubble && (
          <div className="relative w-72 rounded-lg border bg-popover p-3 pe-8 text-sm text-popover-foreground shadow-lg">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{status}</p>
            <p className={cn("max-h-40 overflow-y-auto break-words select-text", phase === "listening" && "text-primary")}>{bubble}</p>
            <button
              type="button"
              onClick={stop}
              aria-label={t("assistant.close")}
              className="absolute top-2 end-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        {on && (
          // Clicking the orb (not dragging it) opens: view conversations / end conversation.
          <DropdownMenu open={menuOpen} onOpenChange={(open) => setMenuOpen(open && !dragged.current)}>
            <DropdownMenuTrigger
              render={
                <motion.button
                  type="button"
                  initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  aria-label={`${status}. ${t("assistant.menu")}`}
                  title={`${status} · ${t("assistant.menu")}`}
                  className="size-20 cursor-grab rounded-full outline-none drop-shadow-lg focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
                />
              }
            >
              <LiveOrb level={level} className="size-full" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-52">
              <DropdownMenuItem onClick={() => navigate("/conversations")}>
                <MessagesSquare />
                {t("assistant.viewConversations")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={stop}>
                <Square />
                {t("assistant.end")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </motion.div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  )
}

import { useTransform } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { listenOnce } from "@/features/speech/listen-once"
import { usePlayback } from "@/features/speech/use-playback"
import { api } from "@/lib/api"

/** The form fields Samvad asks about, in order, and the wizard step each lives on. */
export const INTAKE_FIELDS = [
  { key: "name", step: 1 },
  { key: "age", step: 1 },
  { key: "sex", step: 1 },
  { key: "phone", step: 1 },
  { key: "allergies", step: 2 },
  { key: "conditions", step: 2 },
  { key: "medicines", step: 2 },
  { key: "consent", step: 3 },
] as const

export type IntakeField = (typeof INTAKE_FIELDS)[number]["key"]
export type IntakeValue = string | string[]
/** One spoken turn of the intake, kept in memory until the patient is saved. */
export type IntakeTurn = {
  role: "samvad" | "patient"
  /** Form field the turn belongs to; read-backs use "<field>.confirm". */
  field: string
  text: string
  english?: string
  audio: Blob
}

export type IntakePhase = "idle" | "starting" | "speaking" | "listening" | "thinking" | "done" | "error"

type Prompt = { text: string; english: string; audio: string }
type Parsed = { value: IntakeValue | null; english: string; confirm: boolean }

/** Ask at most twice: a third attempt costs more time than typing the field. */
const MAX_TRIES = 2

function b64ToBlob(b64: string, type = "audio/wav") {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function readBack(field: IntakeField, value: IntakeValue, heard: string) {
  if (field === "phone" && typeof value === "string") return value.replace(/(\d{5})(\d{5})/, "$1 $2")
  if (field === "age" && typeof value === "string") return value
  return heard // allergies, medicines, consent: repeat the patient's own words
}

type Callbacks = {
  onStep: (step: number) => void
  /** A confirmed answer. `heard` is the patient's words verbatim (Critical Rule 6). */
  onField: (field: IntakeField, value: IntakeValue, heard: string, english: string) => void
  onMissed: (field: IntakeField) => void
}

/**
 * Voice-guided New patient form: asks each question aloud in the patient's
 * language, listens for the answer, reads numbers / allergies / medicines /
 * yes-no back for confirmation (Critical Rule 5), and fills the field.
 * Everything filled is a draft the doctor reviews before "Add patient".
 */
export function useVoiceIntake(callbacks: Callbacks) {
  const [phase, setPhase] = useState<IntakePhase>("idle")
  const [question, setQuestion] = useState<{ text: string; english: string } | null>(null)
  const [partial, setPartial] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The conversation recording. Saved only if the patient consents (Critical Rule 3).
  const turns = useRef<IntakeTurn[]>([])
  const cb = useRef(callbacks)
  useEffect(() => {
    cb.current = callbacks
  }, [callbacks])

  const playback = usePlayback()
  const micLevel = useMicLevel(phase === "listening" ? stream : null)
  const level = useTransform([micLevel, playback.level], ([a, b]: number[]) => Math.max(a, b))

  const { play, stop: stopPlayback } = playback

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopPlayback()
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop())
      return null
    })
    setPartial("")
    setPhase((p) => (p === "done" || p === "error" ? p : "idle"))
  }, [stopPlayback])

  const start = useCallback(
    async (language: string, fields: readonly IntakeField[] = INTAKE_FIELDS.map((f) => f.key)) => {
      stop()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const { signal } = ctrl
      setError(null)
      setPhase("starting")
      turns.current = []
      let field = ""

      const check = () => {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      }
      // Fixed questions are fetched ahead (the next one loads while the patient answers).
      const fetched = new Map<string, Promise<Prompt>>()
      const fetchPrompt = (key: string, value?: string) => {
        const load = async () => {
          const res = await api("/intake/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, language, value }),
            signal,
          })
          return (await res.json()) as Prompt
        }
        if (value !== undefined) return load() // read-backs are never reused
        if (!fetched.has(key)) {
          const p = load()
          p.catch(() => fetched.delete(key)) // retry on next use
          fetched.set(key, p)
        }
        return fetched.get(key)!
      }

      const say = async (key: string, value?: string) => {
        setPhase("thinking")
        const p = await fetchPrompt(key, value)
        check()
        setQuestion({ text: p.text, english: p.english })
        setPhase("speaking")
        const audio = b64ToBlob(p.audio)
        turns.current.push({ role: "samvad", field: key === "confirm" ? `${field}.confirm` : field || key, text: p.text, english: p.english, audio })
        await play(audio)
        check()
      }
      const hear = async (mic: MediaStream, turnField: string) => {
        setPartial("")
        setPhase("listening")
        const heard = await listenOnce({ stream: mic, language, signal, onPartial: setPartial })
        check()
        setPartial(heard?.text ?? "")
        if (heard) turns.current.push({ role: "patient", field: turnField, text: heard.text, audio: heard.audio })
        return heard?.text ?? null
      }
      const parse = async (field: string, text: string) => {
        setPhase("thinking")
        const res = await api("/intake/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, language, text }),
          signal,
        })
        check()
        return (await res.json()) as Parsed
      }

      let mic: MediaStream | null = null
      try {
        // Echo cancellation on, so Samvad's own voice isn't transcribed as the answer.
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        check()
        setStream(mic)

        fields.forEach((key) => void fetchPrompt(key).catch(() => {})) // warm every question up front
        void fetchPrompt("retry").catch(() => {})
        for (const key of fields) {
          const step = INTAKE_FIELDS.find((f) => f.key === key)?.step ?? 1
          cb.current.onStep(step)
          field = key
          let done = false
          for (let attempt = 0; attempt < MAX_TRIES && !done; attempt++) {
            await say(attempt === 0 ? key : "retry")
            const heard = await hear(mic, key)
            if (!heard) continue
            const parsed = await parse(key, heard)
            if (parsed.value === null) continue
            const isEmpty = parsed.value === "" || (Array.isArray(parsed.value) && parsed.value.length === 0)
            if (parsed.confirm && !isEmpty) {
              await say("confirm", readBack(key, parsed.value, heard))
              const answer = await hear(mic, `${key}.confirm`)
              if (!answer) continue
              const yes = await parse("confirm", answer)
              if (yes.value !== "yes") continue
            }
            cb.current.onField(key, parsed.value, heard, parsed.english)
            done = true
          }
          if (!done) cb.current.onMissed(key)
        }

        field = "done"
        await say("done")
        setQuestion(null)
        setPartial("")
        setPhase("done")
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setError((err as Error).message || "error")
        setPhase("error")
      } finally {
        mic?.getTracks().forEach((t) => t.stop())
        setStream(null)
        if (abortRef.current === ctrl) abortRef.current = null
      }
    },
    [play, stop],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  const active = phase === "starting" || phase === "speaking" || phase === "listening" || phase === "thinking"
  /** The recorded conversation so far (questions and answers, in order). */
  const recording = useCallback(() => [...turns.current], [])
  const clearRecording = useCallback(() => {
    turns.current = []
  }, [])

  return { phase, active, question, partial, error, level, start, stop, recording, clearRecording }
}

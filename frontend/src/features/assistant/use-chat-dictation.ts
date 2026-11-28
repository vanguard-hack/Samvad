import { useCallback, useEffect, useRef, useState } from "react"

import { listenOnce } from "@/features/speech/listen-once"

/** Dictation stops on its own after this much silence. */
const SILENCE_MS = 20000

type Callbacks = {
  /** Words still being spoken (replaced as recognition firms them up). */
  onInterim: (text: string) => void
  /** A finished phrase. */
  onFinal: (text: string) => void
  /** Dictation ended (toggle, silence, error or leaving the page). */
  onEnd?: () => void
}

/**
 * Dictation for the Samvad Assistant prompt bar, after Sentinel's composer:
 * the words appear in the bar as they are spoken (Sarvam speech-to-text, any
 * Indian language, detected automatically) and nothing is sent until the
 * doctor sends it. The microphone stream is exposed for the voice glow.
 * Audio is never stored.
 */
export function useChatDictation(callbacks: Callbacks) {
  const [listening, setListening] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cb = useRef(callbacks)
  useEffect(() => {
    cb.current = callbacks
  }, [callbacks])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (abortRef.current) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(false)
    setListening(true)
    let mic: MediaStream | null = null
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (ctrl.signal.aborted) return
      setStream(mic)
      while (!ctrl.signal.aborted) {
        const heard = await listenOnce({
          stream: mic,
          language: "auto",
          signal: ctrl.signal,
          timeoutMs: SILENCE_MS,
          onPartial: (text) => cb.current.onInterim(text),
        })
        if (!heard) break // a long silence ends dictation
        cb.current.onFinal(heard.text)
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(true)
    } finally {
      mic?.getTracks().forEach((t) => t.stop())
      if (abortRef.current === ctrl) abortRef.current = null
      setStream(null)
      setListening(false)
      cb.current.onEnd?.()
    }
  }, [])

  const toggle = useCallback(() => {
    if (abortRef.current) stop()
    else void start()
  }, [start, stop])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { listening, stream, error, start, stop, toggle }
}

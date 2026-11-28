import { useCallback, useEffect, useRef, useState } from "react"

import { accessToken } from "@/lib/api"
import { startPcmCapture } from "./pcm-capture"

export type LiveState = "idle" | "connecting" | "listening" | "finishing" | "error"

type Options = {
  /** Samvad language code, or "auto" to let Sarvam detect it (doctors code-mix). */
  language?: string
  /** "codemix" keeps English words (BP, sugar) in English script — Critical Rule 6. */
  mode?: "transcribe" | "codemix"
  /** Called once per finished utterance with the final text. */
  onFinal?: (text: string, language: string | null) => void
}

/**
 * Live speech-to-text through the Samvad backend (Sarvam saaras:v4).
 * `start(stream)` streams the microphone; `stop()` flushes the last utterance.
 * Transcripts only live in React state: nothing is stored.
 */
export function useLiveTranscription({ language = "auto", mode = "codemix", onFinal }: Options = {}) {
  const [state, setState] = useState<LiveState>("idle")
  const [partial, setPartial] = useState("")
  const [error, setError] = useState<string | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const stopCapture = useRef<(() => void) | null>(null)
  const onFinalRef = useRef(onFinal)
  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  const cleanup = useCallback(() => {
    stopCapture.current?.()
    stopCapture.current = null
    const socket = ws.current
    ws.current = null
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close()
  }, [])

  const start = useCallback(
    async (stream: MediaStream) => {
      cleanup()
      setError(null)
      setPartial("")
      setState("connecting")
      let token: string
      try {
        token = await accessToken()
      } catch {
        setState("error")
        setError("auth")
        return
      }
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stt/stream`
      const socket = new WebSocket(url)
      socket.binaryType = "arraybuffer"
      ws.current = socket

      socket.onopen = () => socket.send(JSON.stringify({ type: "start", token, language, mode }))
      socket.onmessage = async (e) => {
        if (typeof e.data !== "string") return
        const msg = JSON.parse(e.data) as { type: string; text?: string; language?: string | null; message?: string }
        if (msg.type === "ready") {
          try {
            stopCapture.current = await startPcmCapture(stream, (pcm) => {
              if (socket.readyState === WebSocket.OPEN) socket.send(pcm)
            })
            setState("listening")
          } catch {
            setState("error")
            setError("capture")
            cleanup()
          }
        } else if (msg.type === "partial") {
          setPartial(msg.text ?? "")
        } else if (msg.type === "final") {
          setPartial("")
          const text = (msg.text ?? "").trim()
          if (text) onFinalRef.current?.(text, msg.language ?? null)
        } else if (msg.type === "error") {
          setState("error")
          setError(msg.message ?? "error")
        } else if (msg.type === "closed") {
          setState((s) => (s === "error" ? s : "idle"))
        }
      }
      socket.onerror = () => {
        setState("error")
        setError("connection")
      }
      socket.onclose = () => {
        stopCapture.current?.()
        stopCapture.current = null
        setState((s) => (s === "error" ? s : "idle"))
      }
    },
    [cleanup, language, mode],
  )

  /** Stop sending audio and let the server flush the last utterance. */
  const stop = useCallback(() => {
    stopCapture.current?.()
    stopCapture.current = null
    const socket = ws.current
    if (socket?.readyState === WebSocket.OPEN) {
      setState("finishing")
      socket.send(JSON.stringify({ type: "end" }))
      // Safety net if the server never answers.
      window.setTimeout(() => socket.readyState <= WebSocket.OPEN && socket.close(), 6000)
    } else {
      cleanup()
      setState("idle")
    }
  }, [cleanup])

  useEffect(() => cleanup, [cleanup])

  return { state, partial, error, start, stop }
}

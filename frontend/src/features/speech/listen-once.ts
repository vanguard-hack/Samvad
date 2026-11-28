import { accessToken } from "@/lib/api"
import { startPcmCapture } from "./pcm-capture"
import { pcmToWav } from "./wav"

type ListenOptions = {
  stream: MediaStream
  /** Samvad language code of the speaker. */
  language: string
  /** Give up if nothing final is heard in this time. */
  timeoutMs?: number
  signal?: AbortSignal
  onPartial?: (text: string) => void
}

export type Heard = { text: string; audio: Blob }

/**
 * Listens for ONE utterance through the live speech-to-text socket and
 * resolves with its final text plus the audio that was heard (WAV, kept in
 * memory only), or null on silence/timeout. Sarvam's voice activity detection
 * decides when the speaker has finished.
 */
export async function listenOnce({ stream, language, timeoutMs = 15000, signal, onPartial }: ListenOptions): Promise<Heard | null> {
  const token = await accessToken()
  const chunks: ArrayBuffer[] = []
  return new Promise<Heard | null>((resolve, reject) => {
    let stopCapture: (() => void) | null = null
    let settled = false
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stt/stream`)
    socket.binaryType = "arraybuffer"

    const finish = (text: string | null, error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      stopCapture?.()
      stopCapture = null
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "end" }))
        window.setTimeout(() => socket.close(), 500)
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      if (error) reject(error)
      else resolve(text ? { text, audio: pcmToWav(chunks) } : null)
    }
    const onAbort = () => finish(null, new DOMException("Aborted", "AbortError"))
    signal?.addEventListener("abort", onAbort)
    const timer = window.setTimeout(() => finish(null), timeoutMs)

    socket.onopen = () => socket.send(JSON.stringify({ type: "start", token, language, mode: "codemix" }))
    socket.onmessage = async (e) => {
      if (typeof e.data !== "string") return
      const msg = JSON.parse(e.data) as { type: string; text?: string; message?: string }
      if (msg.type === "ready") {
        try {
          stopCapture = await startPcmCapture(stream, (pcm) => {
            if (socket.readyState !== WebSocket.OPEN) return
            chunks.push(pcm)
            socket.send(pcm)
          })
          if (settled) stopCapture()
        } catch (err) {
          finish(null, err instanceof Error ? err : new Error("capture"))
        }
      } else if (msg.type === "partial") {
        onPartial?.(msg.text ?? "")
      } else if (msg.type === "final" && msg.text?.trim()) {
        finish(msg.text.trim())
      } else if (msg.type === "error") {
        finish(null, new Error(msg.message ?? "Speech service error"))
      }
    }
    socket.onerror = () => finish(null, new Error("Could not reach the speech service"))
    socket.onclose = () => finish(null)
  })
}

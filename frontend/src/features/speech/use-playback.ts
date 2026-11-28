import { useMotionValue, type MotionValue } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

type Playback = {
  play: (audio: Blob) => Promise<void>
  stop: () => void
  /** Call synchronously inside a key press / click so the browser allows sound later. */
  unlock: () => void
  playing: boolean
  level: MotionValue<number>
}

/** How long to wait for a suspended AudioContext before using an <audio> element instead. */
const RESUME_TIMEOUT_MS = 800

/**
 * Plays Samvad's spoken audio (TTS) and exposes its loudness (0–1) as a
 * MotionValue, so the voice orb moves with Samvad's own voice while it speaks.
 * Audio is played from memory and never cached or stored.
 *
 * Browsers keep an AudioContext silent until a user gesture. `unlock()` creates
 * and resumes it during the gesture (e.g. Ctrl+Space); if it is still suspended
 * when audio arrives, playback falls back to a plain <audio> element so the
 * question is always heard (the orb just won't follow the voice level then).
 */
export function usePlayback(): Playback {
  const level = useMotionValue(0)
  const [playing, setPlaying] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const elementRef = useRef<{ el: HTMLAudioElement; done: () => void } | null>(null)
  const rafRef = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    try {
      sourceRef.current?.stop()
    } catch {
      /* already stopped */
    }
    sourceRef.current = null
    const element = elementRef.current
    elementRef.current = null
    if (element) {
      element.el.pause()
      element.done()
    }
    level.set(0)
    setPlaying(false)
  }, [level])

  const unlock = useCallback(() => {
    const ctx = (ctxRef.current ??= new AudioContext())
    if (ctx.state === "suspended") void ctx.resume().catch(() => {})
  }, [])

  const playElement = useCallback(
    (audio: Blob) =>
      new Promise<void>((resolve, reject) => {
        const url = URL.createObjectURL(audio)
        const el = new Audio(url)
        let finished = false
        const done = (err?: unknown) => {
          if (finished) return
          finished = true
          URL.revokeObjectURL(url)
          if (elementRef.current?.el === el) elementRef.current = null
          setPlaying(false)
          if (err) reject(err instanceof Error ? err : new Error("Couldn't play sound"))
          else resolve()
        }
        elementRef.current = { el, done: () => done() }
        el.onended = () => done()
        el.onerror = () => done(new Error("Couldn't play sound"))
        setPlaying(true)
        // Rejects when the browser blocks sound: surfaced as an error, never skipped silently.
        el.play().catch((err) => done(err))
      }),
    [],
  )

  const play = useCallback(
    async (audio: Blob) => {
      stop()
      const ctx = (ctxRef.current ??= new AudioContext())
      if (ctx.state !== "running") {
        // resume() never settles while the browser blocks sound, so don't wait on it forever.
        await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, RESUME_TIMEOUT_MS))])
      }
      if (ctx.state !== "running") return playElement(audio)

      const buffer = await ctx.decodeAudioData(await audio.arrayBuffer())
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser).connect(ctx.destination)
      sourceRef.current = source

      const buf = new Float32Array(analyser.fftSize)
      let smoothed = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const target = Math.min(1, Math.sqrt(sum / buf.length) * 5)
        smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.15)
        level.set(smoothed)
        rafRef.current = requestAnimationFrame(tick)
      }

      await new Promise<void>((resolve) => {
        source.onended = () => {
          if (sourceRef.current === source) stop()
          resolve()
        }
        setPlaying(true)
        source.start()
        tick()
      })
    },
    [level, playElement, stop],
  )

  useEffect(
    () => () => {
      stop()
      void ctxRef.current?.close()
      ctxRef.current = null
    },
    [stop],
  )

  return { play, stop, unlock, playing, level }
}

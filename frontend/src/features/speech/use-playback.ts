import { useMotionValue, type MotionValue } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Plays Samvad's spoken audio (TTS) and exposes its loudness (0–1) as a
 * MotionValue, so the voice orb moves with Samvad's own voice while it speaks.
 * Audio is played from memory and never cached or stored.
 */
export function usePlayback(): { play: (audio: Blob) => Promise<void>; stop: () => void; playing: boolean; level: MotionValue<number> } {
  const level = useMotionValue(0)
  const [playing, setPlaying] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const rafRef = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    try {
      sourceRef.current?.stop()
    } catch {
      /* already stopped */
    }
    sourceRef.current = null
    level.set(0)
    setPlaying(false)
  }, [level])

  const play = useCallback(
    async (audio: Blob) => {
      stop()
      const ctx = (ctxRef.current ??= new AudioContext())
      if (ctx.state === "suspended") await ctx.resume()
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
    [level, stop],
  )

  useEffect(
    () => () => {
      stop()
      void ctxRef.current?.close()
    },
    [stop],
  )

  return { play, stop, playing, level }
}

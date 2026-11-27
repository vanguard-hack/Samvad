import { useEffect } from "react"
import { useMotionValue, type MotionValue } from "motion/react"

/**
 * Live microphone loudness (0–1) as a MotionValue, so the orb animates without
 * re-rendering React each frame (same approach as the Sentinel voice mode).
 *
 * Audio is only measured in the browser (AnalyserNode). It is never recorded,
 * stored or sent anywhere.
 */
export function useMicLevel(stream: MediaStream | null): MotionValue<number> {
  const level = useMotionValue(0)

  useEffect(() => {
    if (!stream) {
      level.set(0)
      return
    }
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    let smoothed = 0

    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      // Speech RMS is roughly 0.01–0.2; map to 0–1, fast attack / slow release.
      const target = Math.min(1, Math.sqrt(sum / buf.length) * 6)
      smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12)
      level.set(smoothed)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void ctx.close()
      level.set(0)
    }
  }, [stream, level])

  return level
}

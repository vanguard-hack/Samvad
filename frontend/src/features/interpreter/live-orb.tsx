import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTime,
  useTransform,
  type MotionValue,
} from "motion/react"

import { VoiceOrb } from "@/components/agents/voice-orb"
import { cn } from "@/lib/utils"

/** Samvad blue: base, highlight, shadow. */
const ORB_COLORS = ["#3f7be0", "#cfe2ff", "#16336e"] as const

/** One slow breath, as in ChatGPT voice mode while it waits. */
const BREATH_MS = 3000
/** Idle swirl speed and the extra spin a loud voice adds (degrees per second). */
const SPIN_IDLE = 24
const SPIN_VOICE = 160

/**
 * ChatGPT-voice-mode motion for the voice orb:
 * - the cloudy surface swirls round continuously, faster while someone speaks;
 * - while quiet it breathes slowly (about ±4 %), so it never looks frozen;
 * - speech swells it quickly on a soft, slightly bouncy spring (up to +32 %)
 *   and it settles back more slowly when the voice stops.
 * Quiet speech is lifted with a curve so normal talking visibly moves it.
 * Reduced-motion users get a still orb.
 */
export function LiveOrb({ level, className, label }: { level: MotionValue<number>; className?: string; label?: string }) {
  const reduced = useReducedMotion()
  const time = useTime()
  const shaped = useTransform(level, (v) => Math.pow(Math.min(1, Math.max(0, v)), 0.6))
  const swell = useSpring(shaped, { stiffness: 320, damping: 16, mass: 0.7 })
  const scale = useTransform([time, swell], ([t, s]: number[]) => {
    const breath = Math.sin((t / BREATH_MS) * Math.PI * 2) * 0.04 * (1 - Math.min(1, s * 1.5))
    return 1 + breath + s * 0.32
  })

  const rotate = useMotionValue(0)
  useAnimationFrame((_, delta) => {
    if (reduced) return
    rotate.set((rotate.get() + (delta / 1000) * (SPIN_IDLE + swell.get() * SPIN_VOICE)) % 360)
  })

  return (
    <motion.div className={cn("aspect-square", className)} style={{ scale: reduced ? 1 : scale }}>
      <motion.div className="size-full" style={{ rotate }}>
        <VoiceOrb
          colors={ORB_COLORS}
          activity={shaped}
          active
          speed={1.6}
          aria-label={label}
          aria-hidden={label ? undefined : true}
          className="size-full"
        />
      </motion.div>
    </motion.div>
  )
}

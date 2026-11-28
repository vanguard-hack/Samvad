import { motion, useAnimationFrame, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react"
import { Orb, type OrbAdapter, type OrbSignal, type OrbState, type OrbStyle, type OrbThemeRenderer } from "orb-ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { VoiceOrb } from "@/components/agents/voice-orb"
import { cn } from "@/lib/utils"

export type VoiceOrbState = OrbState

/** Samvad blue for the beui liquid orb: base, highlight, shadow. */
const ORB_COLORS = ["#3f7be0", "#cfe2ff", "#16336e"] as const

/** Fills the container; the wrapper's className sets the size. */
const FILL: OrbStyle = { "--orb-ui-size": "100%" }

/**
 * Motion per conversation state: a breath (period, depth), a constant swirl
 * (degrees per second) and the liquid surface's speed. The voice adds a swell
 * and extra spin on top while listening or speaking.
 */
const MOTION: Record<OrbState, { breathMs: number; breath: number; spin: number; speed: number }> = {
  idle: { breathMs: 3000, breath: 0.04, spin: 24, speed: 1.2 },
  connecting: { breathMs: 1400, breath: 0.03, spin: 60, speed: 2.2 },
  listening: { breathMs: 3000, breath: 0.03, spin: 24, speed: 1.6 },
  thinking: { breathMs: 1400, breath: 0.035, spin: 70, speed: 2.4 },
  speaking: { breathMs: 3000, breath: 0.02, spin: 24, speed: 1.6 },
  error: { breathMs: 3000, breath: 0, spin: 0, speed: 0 },
}
const SPIN_VOICE = 160

/**
 * Feeds the live voice level to orb-ui as it changes. orb-ui reads it as the
 * microphone while listening and as Samvad's voice while speaking.
 */
function volumeAdapter(level: MotionValue<number>): OrbAdapter {
  const read = (): OrbSignal => {
    const v = Math.min(1, Math.max(0, level.get()))
    return { state: "listening", inputVolume: v, outputVolume: v }
  }
  return {
    subscribe(listener) {
      listener(read())
      return level.on("change", () => listener(read()))
    },
  }
}

/**
 * The beui liquid orb (the design Samvad had before), drawn as orb-ui custom
 * artwork. orb-ui supplies the state and the direction-selected voice activity;
 * this adds ChatGPT-like motion: a constant swirl, a slow breath, a quicker
 * pulse while thinking, and a springy swell with the voice. It keeps moving
 * when the system asks for reduced motion, by the product owner's choice: the
 * motion is how the doctor sees that Samvad is listening.
 */
function BeuiOrbArt({ state, activity }: { state: OrbState; activity: number }) {
  const level = useMotionValue(activity)
  useEffect(() => level.set(activity), [level, activity])
  const shaped = useTransform(level, (v) => Math.pow(Math.min(1, Math.max(0, v)), 0.6))
  const swell = useSpring(shaped, { stiffness: 320, damping: 16, mass: 0.7 })
  const scale = useMotionValue(1)
  const rotate = useMotionValue(0)
  const mode = useRef(MOTION[state])
  useEffect(() => {
    mode.current = MOTION[state]
  }, [state])

  useAnimationFrame((time, delta) => {
    const m = mode.current
    const s = swell.get()
    const breath = m.breath ? Math.sin((time / m.breathMs) * Math.PI * 2) * m.breath * (1 - Math.min(1, s * 1.5)) : 0
    scale.set(1 + breath + s * 0.3)
    rotate.set((rotate.get() + (delta / 1000) * (m.spin + s * SPIN_VOICE)) % 360)
  })

  return (
    <motion.div className={cn("size-full transition-[opacity,filter] duration-500", state === "error" && "opacity-60 grayscale-[0.4]")} style={{ scale }}>
      <motion.div className="size-full" style={{ rotate }}>
        <VoiceOrb
          colors={ORB_COLORS}
          activity={shaped}
          active={state !== "error"}
          speed={MOTION[state].speed}
          respectReducedMotion={false}
          className="size-full"
        />
      </motion.div>
    </motion.div>
  )
}

const renderBeuiOrb: OrbThemeRenderer = ({ rootProps, state, activity }) => (
  <div {...rootProps} style={{ ...rootProps.style, width: "100%", height: "100%" }}>
    <BeuiOrbArt state={state} activity={activity} />
  </div>
)

/**
 * The voice orb: orb-ui (orb-ui.com) runs the state and voice signal, and the
 * artwork is the beui liquid orb in Samvad blue. Purely visual: whatever wraps
 * it (a button, a menu trigger) handles clicks.
 */
export function LiveOrb({
  level,
  state = "listening",
  className,
  label,
}: {
  level: MotionValue<number>
  state?: VoiceOrbState
  className?: string
  label?: string
}) {
  const adapter = useMemo(() => volumeAdapter(level), [level])
  return (
    <div
      className={cn("aspect-square", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Orb adapter={adapter} state={state} interactive={false} style={FILL} renderTheme={renderBeuiOrb} />
    </div>
  )
}

function useElapsedSeconds(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [startedAt])
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/** 75 → "1:15"; an hour or more → "1:02:05". */
function formatElapsed(total: number) {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/**
 * The status pills from the orb-ui demo, under the orb: the conversation state
 * and how long the conversation has been going.
 */
export function VoiceSessionChips({ state, startedAt, className }: { state: VoiceOrbState; startedAt: number | null; className?: string }) {
  const { t } = useTranslation()
  const seconds = useElapsedSeconds(startedAt)
  const pill = "rounded-full border bg-popover/95 px-2.5 py-1 font-mono text-[10px] leading-none tracking-wider text-muted-foreground shadow-sm"
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn(pill, "uppercase")}>{t(`voiceOrb.state.${state}`)}</span>
      <span className={cn(pill, "tabular-nums")} title={t("voiceOrb.time")} aria-label={`${t("voiceOrb.time")}: ${formatElapsed(seconds)}`}>
        {formatElapsed(seconds)}
      </span>
    </div>
  )
}

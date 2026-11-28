import { motion, useReducedMotion } from "motion/react"

import { DoctorIcon } from "@/features/assistant/doctor-icon"
import { cn } from "@/lib/utils"

/** The same sky → fuchsia → amber sweep as the "Generate report" border, closed into a loop. */
const AURORA_CONIC =
  "bg-[conic-gradient(from_0deg,var(--color-sky-500),var(--color-fuchsia-500),var(--color-amber-400),var(--color-sky-500))]"

const SIZES = {
  sm: { box: "size-8", icon: "size-4", ring: "inset-[1.5px]", glow: "blur-[6px]" },
  lg: { box: "size-20", icon: "size-9", ring: "inset-[2.5px]", glow: "blur-xl" },
} as const

type Props = {
  size?: keyof typeof SIZES
  /** Spins faster and glows brighter while an answer is on its way. */
  thinking?: boolean
  className?: string
}

/** The assistant's face: a doctor in a lab coat inside a slowly turning aurora ring. */
export function AssistantOrb({ size = "sm", thinking = false, className }: Props) {
  const reduced = useReducedMotion()
  const s = SIZES[size]
  const spin = reduced
    ? undefined
    : { animate: { rotate: 360 }, transition: { duration: thinking ? 1.6 : size === "lg" ? 10 : 14, repeat: Infinity, ease: "linear" as const } }

  return (
    <span aria-hidden="true" className={cn("relative grid shrink-0 place-items-center rounded-full", s.box, className)}>
      <motion.span
        className={cn("absolute inset-0 rounded-full transition-opacity duration-500", AURORA_CONIC, s.glow, thinking ? "opacity-80" : "opacity-40")}
        {...spin}
      />
      <motion.span className={cn("absolute inset-0 rounded-full", AURORA_CONIC)} {...spin} />
      <span className={cn("absolute rounded-full bg-card", s.ring)} />
      <DoctorIcon className={cn("relative text-foreground", s.icon)} strokeWidth={size === "lg" ? 1.6 : 1.9} />
    </span>
  )
}

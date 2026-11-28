import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"

/** Total time for a sentence to settle, however long it is. */
const MAX_STAGGER_S = 0.7

/** Text that arrives word by word, out of a soft blur. Plain text when motion is reduced or `animate` is off. */
export function RevealText({ text, animate, delay = 0 }: { text: string; animate: boolean; delay?: number }) {
  const reduced = useReducedMotion()
  if (!animate || reduced) return <>{text}</>

  const words = text.split(/(\s+)/)
  const step = Math.min(0.03, MAX_STAGGER_S / Math.max(1, words.length / 2))
  return (
    <>
      {/* Screen readers get the sentence once, not word by word. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((w, i) =>
          /^\s+$/.test(w) ? (
            w
          ) : (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ opacity: 0, filter: "blur(4px)", y: 3 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT, delay: delay + (i / 2) * step }}
            >
              {w}
            </motion.span>
          ),
        )}
      </span>
    </>
  )
}

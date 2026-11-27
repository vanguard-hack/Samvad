import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMicrophone, VoiceBeam, type MicrophoneState } from "voice-glow"

import { VoiceNote } from "@/components/agents/voice-note"
import { VoiceOrb } from "@/components/agents/voice-orb"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { useIsMobile } from "@/hooks/use-mobile"

/** Same palette as the Sentinel voice mode (Samvad blue): base, highlight, shadow. */
const ORB_COLORS = ["#3f7be0", "#cfe2ff", "#16336e"] as const

/** beui's voice-note is 40px tall; zoom keeps its layout, hit areas and focus rings correct. */
const RECORDER_ZOOM = { desktop: 1.5, mobile: 1.3 }

const STATUS_KEY: Record<MicrophoneState, string> = {
  idle: "interpreter.status.idle",
  requesting: "interpreter.status.connecting",
  live: "interpreter.status.listening",
  denied: "interpreter.status.denied",
  unsupported: "interpreter.status.unsupported",
  error: "interpreter.status.error",
}

export function InterpreterPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { theme } = useTheme()
  const mic = useMicrophone()
  const live = mic.state === "live"
  const level = useMicLevel(live ? mic.stream : null)
  const failed = mic.state === "denied" || mic.state === "unsupported" || mic.state === "error"
  // Remounts the recorder so it folds back to the mic when the microphone fails.
  const [recorderKey, setRecorderKey] = useState(0)
  const [lastSeconds, setLastSeconds] = useState<number | null>(null)
  const [failureSeen, setFailureSeen] = useState(false)

  if (failed && !failureSeen) {
    setFailureSeen(true)
    setRecorderKey((k) => k + 1)
  }

  const recorder = (
    <div style={{ zoom: isMobile ? RECORDER_ZOOM.mobile : RECORDER_ZOOM.desktop }} className="w-full max-w-sm">
      <VoiceNote
        key={recorderKey}
        level={level}
        disabled={!mic.supported}
        labels={{
          record: t("interpreter.note.record"),
          send: t("interpreter.note.send"),
          discard: t("interpreter.note.discard"),
          recording: t("interpreter.note.recording"),
          sent: t("interpreter.note.sent"),
        }}
        onRecordStart={() => {
          setLastSeconds(null)
          setFailureSeen(false)
          void mic.start() // from the click, so browsers allow the microphone
        }}
        onDiscard={() => mic.stop()}
        onSend={(durationMs) => {
          mic.stop()
          setLastSeconds(Math.max(1, Math.round(durationMs / 1000)))
        }}
      />
    </div>
  )

  const status = (
    <div className="flex flex-col items-center gap-2 text-center">
      <p role="status" aria-live="polite" className="text-base font-medium">
        {lastSeconds !== null && mic.state === "idle"
          ? t("interpreter.captured", { seconds: lastSeconds })
          : t(STATUS_KEY[mic.state])}
      </p>
      {(live || lastSeconds !== null) && (
        <Badge variant="outline" className="border-caution/40 bg-caution-soft text-caution">
          {t("interpreter.notConnected")}
        </Badge>
      )}
      {failed && <p className="max-w-xs text-sm text-muted-foreground">{t("interpreter.micHelp")}</p>}
      <p className="max-w-xs text-xs text-muted-foreground">{t("interpreter.privacy")}</p>
    </div>
  )

  // ── Phone: Voice Glow rising from the bottom edge (libraries.dev/voice) ──
  if (isMobile) {
    return (
      <VoiceBeam type="mobile" stream={live ? mic.stream : null} theme={theme === "system" ? "auto" : theme} className="h-full">
        <div className="flex h-full flex-col items-center justify-center gap-8 p-6 pb-40">
          {status}
          {recorder}
        </div>
      </VoiceBeam>
    )
  }

  // ── PC / tablet: beui voice orb + big beui voice-note recorder ───────────
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6">
      <VoiceOrb
        colors={ORB_COLORS}
        activity={level}
        active={!failed}
        aria-label={t(STATUS_KEY[mic.state])}
        className="w-56 lg:w-64"
      />
      {status}
      {recorder}
    </div>
  )
}

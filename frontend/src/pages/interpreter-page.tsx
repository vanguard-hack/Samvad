import { Loader2, Square, Volume2 } from "lucide-react"
import { useTransform } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMicrophone, VoiceBeam, type MicrophoneState } from "voice-glow"

import { VoiceNote } from "@/components/agents/voice-note"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LiveOrb } from "@/features/interpreter/live-orb"
import { useMicLevel } from "@/features/interpreter/use-mic-level"
import { useLiveTranscription } from "@/features/speech/use-live-transcription"
import { usePlayback } from "@/features/speech/use-playback"
import { useIsMobile } from "@/hooks/use-mobile"
import { getLanguage } from "@/i18n/languages"
import { fromSarvamCode, speak } from "@/lib/api"

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

type Line = { id: number; text: string; language: string | null }

export function InterpreterPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { theme } = useTheme()
  const mic = useMicrophone()
  const live = mic.state === "live"
  const micLevel = useMicLevel(live ? mic.stream : null)
  const playback = usePlayback()
  // The orb follows whoever is talking: the microphone, or Samvad's own voice.
  const level = useTransform([micLevel, playback.level], ([a, b]: number[]) => Math.max(a, b))
  const failed = mic.state === "denied" || mic.state === "unsupported" || mic.state === "error"
  // Remounts the recorder so it folds back to the mic when the microphone fails.
  const [recorderKey, setRecorderKey] = useState(0)
  const [failureSeen, setFailureSeen] = useState(false)
  // Transcript lives in memory only and is gone when the page closes.
  const [lines, setLines] = useState<Line[]>([])
  const [speakingId, setSpeakingId] = useState<number | null>(null)
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [speakError, setSpeakError] = useState(false)

  const transcription = useLiveTranscription({
    language: "auto",
    mode: "codemix", // keep English words like "BP", "sugar" as spoken (Critical Rule 6)
    onFinal: (text, language) =>
      setLines((l) => [...l, { id: Date.now() + Math.random(), text, language: fromSarvamCode(language) }]),
  })

  if (failed && !failureSeen) {
    setFailureSeen(true)
    setRecorderKey((k) => k + 1)
  }

  const readAloud = async (line: Line) => {
    if (speakingId === line.id) {
      playback.stop()
      setSpeakingId(null)
      return
    }
    setSpeakError(false)
    setLoadingId(line.id)
    try {
      const audio = await speak(line.text, line.language ?? "en")
      setLoadingId(null)
      setSpeakingId(line.id)
      await playback.play(audio)
    } catch {
      setSpeakError(true)
    } finally {
      setLoadingId(null)
      setSpeakingId((id) => (id === line.id ? null : id))
    }
  }

  const recorder = (
    <div style={{ zoom: isMobile ? RECORDER_ZOOM.mobile : RECORDER_ZOOM.desktop }} className="w-full max-w-sm">
      <VoiceNote
        key={recorderKey}
        level={micLevel}
        disabled={!mic.supported}
        labels={{
          record: t("interpreter.note.record"),
          send: t("interpreter.note.send"),
          discard: t("interpreter.note.discard"),
          recording: t("interpreter.note.recording"),
          sent: t("interpreter.note.sent"),
        }}
        onRecordStart={() => {
          setFailureSeen(false)
          playback.stop()
          // From the click, so browsers allow the microphone.
          void mic.start().then((stream) => stream && transcription.start(stream))
        }}
        onDiscard={() => {
          transcription.stop()
          mic.stop()
        }}
        onSend={() => {
          transcription.stop()
          mic.stop()
        }}
      />
    </div>
  )

  const statusText =
    transcription.state === "error"
      ? t("interpreter.sttUnavailable")
      : transcription.state === "finishing"
        ? t("interpreter.status.finishing")
        : t(STATUS_KEY[mic.state])

  const transcript = (lines.length > 0 || transcription.partial) && (
    <div className="flex max-h-56 w-full max-w-xl flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-3 text-sm">
      {lines.map((line) => {
        const lang = line.language ? getLanguage(line.language) : null
        // Only the 11 languages Sarvam can speak get a voice; never fake the others.
        const canSpeak = !!lang?.voice
        return (
          <div key={line.id} className="flex items-start gap-2">
            <p className="flex-1 break-words" lang={line.language ?? undefined} dir={lang?.dir}>
              {line.text}
            </p>
            {lang && (
              <Badge variant="outline" className="shrink-0">
                {lang.englishName}
              </Badge>
            )}
            {canSpeak && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void readAloud(line)}
                aria-label={speakingId === line.id ? t("interpreter.stopSpeaking") : t("interpreter.readAloud")}
                title={speakingId === line.id ? t("interpreter.stopSpeaking") : t("interpreter.readAloud")}
              >
                {loadingId === line.id ? <Loader2 className="animate-spin" /> : speakingId === line.id ? <Square /> : <Volume2 />}
              </Button>
            )}
          </div>
        )
      })}
      {transcription.partial && <p className="text-muted-foreground">{transcription.partial}</p>}
    </div>
  )

  const status = (
    <div className="flex flex-col items-center gap-2 text-center">
      <p role="status" aria-live="polite" className="text-base font-medium">
        {statusText}
      </p>
      {failed && <p className="max-w-xs text-sm text-muted-foreground">{t("interpreter.micHelp")}</p>}
      {speakError && <p className="max-w-xs text-sm text-destructive">{t("interpreter.ttsError")}</p>}
      <p className="max-w-xs text-xs text-muted-foreground">{t("interpreter.privacy")}</p>
    </div>
  )

  // ── Phone: Voice Glow rising from the bottom edge (libraries.dev/voice) ──
  if (isMobile) {
    return (
      <VoiceBeam type="mobile" stream={live ? mic.stream : null} theme={theme === "system" ? "auto" : theme} className="h-full">
        <div className="flex h-full flex-col items-center justify-center gap-6 p-6 pb-40">
          {status}
          {transcript}
          {recorder}
        </div>
      </VoiceBeam>
    )
  }

  // ── PC / tablet: voice orb + transcript + big voice-note recorder ────────
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <LiveOrb
        level={level}
        label={statusText}
        state={
          failed
            ? "error"
            : mic.state === "requesting"
              ? "connecting"
              : speakingId !== null
                ? "speaking"
                : loadingId !== null
                  ? "thinking"
                  : live
                    ? "listening"
                    : "idle"
        }
        className="my-4 w-48 lg:w-56"
      />
      {status}
      {transcript}
      {recorder}
    </div>
  )
}

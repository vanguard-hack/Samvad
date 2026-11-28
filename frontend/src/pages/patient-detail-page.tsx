import { ArrowLeft, Eye, EyeOff, Loader2, UserRound } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router"

import { LogoMark } from "@/components/brand/logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PATIENT_STATUS_BADGE } from "@/features/patients/columns"
import { getPatient, intakeAudioUrls, maskPhone, patientCode, type PatientRow } from "@/features/patients/patients-api"
import { getSessionPatient } from "@/features/patients/session-patients"
import { INTAKE_FIELDS } from "@/features/patients/use-voice-intake"
import { getLanguage } from "@/i18n/languages"
import { cn } from "@/lib/utils"

/** Everything recorded for one patient in the New patient form. */
export function PatientDetailPage() {
  const { t, i18n } = useTranslation()
  const { patientId = "" } = useParams()
  const session = getSessionPatient(patientId)
  const [patient, setPatient] = useState<PatientRow | null>(session)
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(session ? "ready" : "loading")
  const [showPhone, setShowPhone] = useState(false)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})

  // Signed, short-lived links for the stored intake audio (private bucket).
  useEffect(() => {
    const paths = (patient?.intake_log ?? []).map((t) => t.audio_path).filter((p): p is string => !!p)
    if (!paths.length) return
    let cancelled = false
    intakeAudioUrls(paths)
      .then((urls) => !cancelled && setAudioUrls(urls))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [patient])

  useEffect(() => {
    if (session) return
    let cancelled = false
    getPatient(patientId)
      .then((p) => {
        if (cancelled) return
        setPatient(p)
        setState(p ? "ready" : "missing")
      })
      .catch(() => !cancelled && setState("error"))
    return () => {
      cancelled = true
    }
  }, [patientId, session])

  const back = (
    <Button variant="ghost" size="sm" className="-ms-2 w-fit" nativeButton={false} render={<Link to="/" />}>
      <ArrowLeft />
      {t("patients.title")}
    </Button>
  )

  if (state !== "ready" || !patient) {
    return (
      <div className="flex h-full flex-col gap-4 p-5">
        {back}
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          {state === "loading" && <Loader2 className="size-4 animate-spin" />}
          {t(`patientDetail.${state}`)}
        </p>
      </div>
    )
  }

  const lang = getLanguage(patient.language)
  const status = PATIENT_STATUS_BADGE[patient.status]
  const unsaved = patient.consent === "declined"
  const none = t("newPatient.noneRecorded")
  const words = INTAKE_FIELDS.filter((f) => patient.patient_words?.[f.key])
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      {back}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{patient.full_name}</h1>
        {unsaved ? (
          <Badge variant="outline" className="border-caution/40 bg-caution-soft text-caution">
            {t("patients.notSaved")}
          </Badge>
        ) : (
          <Badge variant="secondary" className="font-mono">
            {patientCode(patient.patient_number)}
          </Badge>
        )}
        <Badge variant={status.variant} className={status.className}>
          {t(`patients.status.${patient.status}`)}
        </Badge>
      </div>
      {unsaved && <p className="text-xs text-caution">{t("newPatient.unsavedNote")}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("newPatient.step.details")}>
          <Row label={t("auth.fullName")}>{patient.full_name}</Row>
          <Row label={t("newPatient.age")}>{patient.age}</Row>
          <Row label={t("newPatient.sex")}>{t(`patients.sex.${patient.sex}`)}</Row>
          <Row label={t("newPatient.phone")}>
            {patient.phone ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {showPhone ? `+91 ${patient.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}` : maskPhone(patient.phone)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowPhone((v) => !v)}
                  aria-label={showPhone ? t("patientDetail.hidePhone") : t("patientDetail.showPhone")}
                >
                  {showPhone ? <EyeOff /> : <Eye />}
                </Button>
              </span>
            ) : (
              none
            )}
          </Row>
        </Section>

        <Section title={t("newPatient.step.language")}>
          <Row label={t("newPatient.language")}>
            {lang.englishName}
            {lang.code !== "en" && (
              <span lang={lang.code} dir={lang.dir} className="ms-1.5 text-muted-foreground">
                {lang.nativeName}
              </span>
            )}
            {!lang.voice && <span className="text-caution"> · {t("newPatient.pictureMode")}</span>}
          </Row>
          <Row label={t("newPatient.canRead")}>{patient.can_read ? t("patientDetail.yes") : t("patientDetail.no")}</Row>
          <Row label={t("newPatient.companion")}>{patient.companion ? t("patientDetail.yes") : t("patientDetail.no")}</Row>
        </Section>

        <Section title={t("newPatient.step.health")}>
          <Row label={t("newPatient.allergies")}>{patient.allergies || none}</Row>
          <Row label={t("newPatient.conditions")}>
            {patient.conditions.length ? patient.conditions.map((c) => t(`newPatient.condition.${c}`)).join(", ") : none}
          </Row>
          <Row label={t("newPatient.medicines")}>{patient.medicines || none}</Row>
        </Section>

        <Section title={t("patientDetail.record")}>
          <Row label={t("newPatient.consent")}>{t(`newPatient.consentOption.${patient.consent}`)}</Row>
          <Row label={t("patientDetail.registered")}>{date(patient.created_at)}</Row>
          <Row label={t("patients.col.lastVisit")}>{date(patient.last_visit)}</Row>
          <Row label={t("patients.col.visits")}>{patient.visits}</Row>
        </Section>
      </div>

      {patient.intake_log.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border bg-background p-4">
          <div>
            <h2 className="text-sm font-semibold">{t("patientDetail.recording")}</h2>
            <p className="text-xs text-muted-foreground">{t("patientDetail.recordingHint")}</p>
          </div>
          <ol className="flex flex-col gap-2">
            {patient.intake_log.map((turn) => {
              const isPatient = turn.role === "patient"
              const url = turn.audio_path ? audioUrls[turn.audio_path] : undefined
              return (
                <li key={turn.seq} className={cn("flex flex-col gap-1.5 rounded-md p-2.5 sm:flex-row sm:items-center sm:gap-3", isPatient ? "bg-primary/5" : "bg-muted/50")}>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium sm:w-28">
                    {isPatient ? (
                      <UserRound className="size-3.5 text-primary" aria-hidden="true" />
                    ) : (
                      <LogoMark className="size-3.5" />
                    )}
                    {isPatient ? t("patientDetail.patient") : "Samvad"}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p lang={patient.language} dir={lang.dir} className="break-words">
                      {turn.text}
                    </p>
                    {turn.english && turn.english !== turn.text && (
                      <p className="text-xs text-muted-foreground">{turn.english}</p>
                    )}
                  </div>
                  {turn.audio_path ? (
                    url ? (
                      <audio controls preload="none" src={url} className="h-8 w-full sm:w-56" aria-label={t("patientDetail.play")} />
                    ) : (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("patientDetail.noAudio")}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {words.length > 0 && (
        <Section title={t("patientDetail.patientWords")} description={t("patientDetail.patientWordsHint")}>
          {words.map((f) => (
            <Row key={f.key} label={t(`newPatient.voice.field.${f.key}`)}>
              <span lang={patient.language} dir={lang.dir}>
                “{patient.patient_words[f.key]}”
              </span>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-background p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <dl className="grid grid-cols-[minmax(8rem,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">{children}</dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

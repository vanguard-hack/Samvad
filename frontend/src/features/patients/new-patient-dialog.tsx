// "New patient" wizard, after shadcn.io's stepper-dialog-wizard block (a Dialog
// with a numbered step line, one panel per step, Back + one primary action).
// That block's code is Pro-only, so this is rebuilt from its description.
import { AlertTriangle, CheckIcon, Loader2, Mic, Square } from "lucide-react"
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type Sex } from "@/data/sample"
import { LiveOrb } from "@/features/interpreter/live-orb"
import { getLanguage, LANGUAGES } from "@/i18n/languages"
import { cn } from "@/lib/utils"
import { maskPhone, type NewPatient } from "./patients-api"
import { useVoiceIntake, type IntakeField, type IntakeTurn, type IntakeValue } from "./use-voice-intake"

// Language comes first: choosing a voice language starts the spoken questions.
const STEPS = ["language", "details", "health", "review"] as const
type Step = (typeof STEPS)[number]

export const CONDITIONS = ["diabetes", "hypertension", "asthma", "heart", "thyroid", "kidney"] as const
type Condition = (typeof CONDITIONS)[number]

type Consent = "given" | "declined"

interface Draft {
  name: string
  age: string
  sex: Sex | ""
  phone: string
  language: string
  canRead: boolean
  companion: boolean
  allergies: string
  conditions: Condition[]
  medicines: string
  consent: Consent | ""
}

const EMPTY: Draft = {
  name: "",
  age: "",
  sex: "",
  phone: "",
  language: "",
  canRead: true,
  companion: false,
  allergies: "",
  conditions: [],
  medicines: "",
  consent: "",
}

const MAX_NAME = 80

type Errors = Partial<Record<keyof Draft, string>>

function validate(step: Step, d: Draft): Errors {
  const e: Errors = {}
  if (step === "details") {
    const name = d.name.trim()
    if (!name) e.name = "nameRequired"
    else if (name.length > MAX_NAME) e.name = "nameLong"
    const age = Number(d.age)
    if (d.age.trim() === "") e.age = "ageRequired"
    else if (!Number.isInteger(age) || age < 0 || age > 120) e.age = "ageRange"
    if (!d.sex) e.sex = "sexRequired"
    const digits = d.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")
    if (d.phone.trim() && !/^[6-9]\d{9}$/.test(digits)) e.phone = "phoneInvalid"
  }
  if (step === "language" && !d.language) e.language = "languageRequired"
  if (step === "review" && !d.consent) e.consent = "consentRequired"
  return e
}

export type NewPatientInput = NewPatient & { consent: Consent; recording: IntakeTurn[] }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saves (consent given) or keeps in memory (declined); resolves with the patient code, or null if unsaved. */
  onCreate: (patient: NewPatientInput) => Promise<string | null>
}

export function NewPatientDialog({ open, onOpenChange, onCreate }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  // "" = added but not saved (consent declined); a code = saved.
  const [created, setCreated] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([])
  // The patient's words, verbatim, for each field filled by voice (Critical Rule 6).
  const [heard, setHeard] = useState<Partial<Record<IntakeField, string>>>({})
  const [missed, setMissed] = useState<IntakeField[]>([])

  const intake = useVoiceIntake({
    onStep: (i) => {
      setStep(i)
      setReached((r) => Math.max(r, i))
    },
    onField: (field, value: IntakeValue, words) => {
      setHeard((h) => ({ ...h, [field]: words }))
      setDraft((d) => {
        if (field === "conditions") return { ...d, conditions: (value as string[]).filter((c): c is Condition => (CONDITIONS as readonly string[]).includes(c)) }
        if (field === "sex") return { ...d, sex: value as Sex }
        if (field === "consent") return { ...d, consent: value as Consent }
        return { ...d, [field]: value as string }
      })
      setErrors((e) => ({ ...e, [field]: undefined }))
    },
    onMissed: (field) => setMissed((m) => [...m, field]),
  })

  const current = STEPS[step]
  const lang = draft.language ? getLanguage(draft.language) : null

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const reset = () => {
    intake.stop()
    intake.clearRecording()
    setHeard({})
    setMissed([])
    setStep(0)
    setReached(0)
    setDraft(EMPTY)
    setErrors({})
    setCreated(null)
  }

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) reset()
  }

  const goTo = (i: number) => {
    setErrors({})
    setStep(i)
    setReached((r) => Math.max(r, i))
  }

  const next = async () => {
    if (created !== null) return close(false)
    const e = validate(current, draft)
    setErrors(e)
    if (Object.keys(e).length) return
    if (current !== "review") return goTo(step + 1)
    if (saving) return
    setSaving(true)
    setSaveError(false)
    try {
      const digits = draft.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")
      const code = await onCreate({
        full_name: draft.name.trim().replace(/\s+/g, " "),
        age: Number(draft.age),
        sex: draft.sex as Sex,
        phone: digits || null,
        language: draft.language,
        can_read: draft.canRead,
        companion: draft.companion,
        allergies: draft.allergies.trim() || null,
        conditions: draft.conditions,
        medicines: draft.medicines.trim() || null,
        patient_words: heard as Record<string, string>,
        consent: draft.consent as Consent,
        recording: intake.recording(),
      })
      setCreated(code ?? "")
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  // The step line is one tab stop; arrow keys move between reached steps.
  const onStepKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (created !== null) return
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const rtl = document.documentElement.dir === "rtl"
    const i = Math.min(reached, Math.max(0, step + (rtl ? -dir : dir)))
    goTo(i)
    stepRefs.current[i]?.focus()
  }

  const err = (key: keyof Draft) => (errors[key] ? t(`newPatient.errors.${errors[key]}`) : undefined)
  // A fixed two-line slot so the dialog doesn't jump when a message appears.
  const said = (key: keyof Draft) =>
    heard[key as IntakeField] ? t("newPatient.voice.patientSaid", { text: heard[key as IntakeField] }) : undefined
  const slot = (key: keyof Draft, hint?: ReactNode) =>
    errors[key] ? (
      <FieldError className="min-h-4 text-xs">{err(key)}</FieldError>
    ) : (
      <FieldDescription className="min-h-4 text-xs">{said(key) ?? hint}</FieldDescription>
    )

  const startVoice = (code: string) => {
    setHeard({})
    setMissed([])
    void intake.start(code)
  }

  const voicePanel = intake.phase !== "idle" && created === null && (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/40 px-4 pt-4 pb-2.5 text-center" aria-live="polite">
      {/* Same live orb as the interpreter: swirls, breathes, and swells with whoever is speaking. */}
      <LiveOrb level={intake.level} className="size-24" />
      <div className="flex min-h-12 w-full flex-col items-center gap-0.5 text-sm">
        {intake.phase === "done" ? (
          <>
            <p className="font-medium">{t("newPatient.voice.done")}</p>
            {missed.length > 0 && (
              <p className="text-xs text-caution">
                {t("newPatient.voice.missed", { fields: missed.map((f) => t(`newPatient.voice.field.${f}`)).join(", ") })}
              </p>
            )}
          </>
        ) : intake.phase === "error" ? (
          <p className="text-destructive">{t("newPatient.voice.error")}</p>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">{t(`newPatient.voice.phase.${intake.phase}`)}</p>
            {intake.question && (
              <p className="line-clamp-2" lang={draft.language} dir={lang?.dir}>
                {intake.question.text}
              </p>
            )}
            {intake.question && draft.language !== "en" && (
              <p className="line-clamp-1 text-xs text-muted-foreground">{intake.question.english}</p>
            )}
            {intake.partial && (
              <p className="line-clamp-1 text-xs text-primary" lang={draft.language}>
                “{intake.partial}”
              </p>
            )}
          </>
        )}
      </div>
      {intake.active ? (
        <Button type="button" variant="outline" size="xs" onClick={intake.stop}>
          <Square />
          {t("newPatient.voice.stop")}
        </Button>
      ) : (
        lang?.voice && (
          <Button type="button" variant="outline" size="xs" onClick={() => startVoice(draft.language)}>
            <Mic />
            {t("newPatient.voice.again")}
          </Button>
        )
      )}
    </div>
  )

  const primaryLabel = created !== null
    ? t("newPatient.done")
    : current === "review"
      ? t("newPatient.create")
      : t("newPatient.continue")

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newPatient.title")}</DialogTitle>
          <DialogDescription>{t("newPatient.description")}</DialogDescription>
        </DialogHeader>

        {/* Step line: numbered circles joined by a line; labels hidden on phones. */}
        <ol aria-label={t("newPatient.steps")} onKeyDown={onStepKey} className="flex items-center">
          {STEPS.map((s, i) => {
            const done = i < step || created !== null
            const active = i === step && created === null
            const reachable = i <= reached && created === null
            return (
              <li key={s} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                <button
                  ref={(el) => {
                    stepRefs.current[i] = el
                  }}
                  type="button"
                  tabIndex={active ? 0 : -1}
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  onClick={() => goTo(i)}
                  className="group flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors",
                      done && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary text-primary ring-3 ring-primary/15",
                      !done && !active && "border-border text-muted-foreground",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" aria-hidden="true" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "sr-only text-xs font-medium sm:not-sr-only",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t(`newPatient.step.${s}`)}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span aria-hidden="true" className={cn("mx-2 h-px flex-1", i < step || created !== null ? "bg-primary" : "bg-border")} />
                )}
              </li>
            )
          })}
        </ol>

        {voicePanel}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void next()
          }}
          className="min-h-60"
        >
          {created !== null ? (
            <div role="status" className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckIcon className="size-5" aria-hidden="true" />
              </span>
              {created ? (
                <>
                  <p className="font-medium">{t("newPatient.created", { name: draft.name.trim(), id: created })}</p>
                  <p className="max-w-xs text-xs text-muted-foreground">{t("newPatient.savedNote")}</p>
                </>
              ) : (
                <>
                  <p className="font-medium">{t("newPatient.addedUnsaved", { name: draft.name.trim() })}</p>
                  <p className="max-w-xs text-xs text-caution">{t("newPatient.unsavedNote")}</p>
                </>
              )}
            </div>
          ) : current === "details" ? (
            <FieldGroup className="gap-3">
              <Field className="gap-1.5" data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="np-name">{t("auth.fullName")}</FieldLabel>
                <Input
                  id="np-name"
                  autoComplete="off"
                  value={draft.name}
                  maxLength={MAX_NAME + 20}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={() => setErrors((x) => ({ ...x, name: validate("details", draft).name }))}
                  aria-invalid={!!errors.name || undefined}
                />
                {slot("name")}
              </Field>
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <Field className="gap-1.5" data-invalid={!!errors.age || undefined}>
                  <FieldLabel htmlFor="np-age">{t("newPatient.age")}</FieldLabel>
                  <Input
                    id="np-age"
                    inputMode="numeric"
                    value={draft.age}
                    onChange={(e) => set("age", e.target.value.replace(/\D/g, "").slice(0, 3))}
                    aria-invalid={!!errors.age || undefined}
                  />
                  {slot("age")}
                </Field>
                <FieldSet className="gap-1.5" data-invalid={!!errors.sex || undefined}>
                  <FieldLegend variant="label" className="mb-0">
                    {t("newPatient.sex")}
                  </FieldLegend>
                  <RadioGroup
                    value={draft.sex}
                    onValueChange={(v) => set("sex", v as Sex)}
                    className="flex h-8 items-center gap-4"
                    aria-invalid={!!errors.sex || undefined}
                  >
                    {(["F", "M", "O"] as const).map((s) => (
                      <Label key={s} className="font-normal">
                        <RadioGroupItem value={s} />
                        {t(`patients.sex.${s}`)}
                      </Label>
                    ))}
                  </RadioGroup>
                  {slot("sex")}
                </FieldSet>
              </div>
              <Field className="gap-1.5" data-invalid={!!errors.phone || undefined}>
                <FieldLabel htmlFor="np-phone">
                  {t("newPatient.phone")} <span className="font-normal text-muted-foreground">{t("newPatient.optional")}</span>
                </FieldLabel>
                <Input
                  id="np-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="98765 43210"
                  value={draft.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  aria-invalid={!!errors.phone || undefined}
                />
                {slot("phone")}
              </Field>
            </FieldGroup>
          ) : current === "language" ? (
            <FieldGroup className="gap-3">
              <Field className="gap-1.5" data-invalid={!!errors.language || undefined}>
                <FieldLabel htmlFor="np-language">{t("newPatient.language")}</FieldLabel>
                <Select
                  value={draft.language || null}
                  onValueChange={(v) => {
                    const code = (v as string) ?? ""
                    set("language", code)
                    // A voice language starts the spoken questions at once (from this click,
                    // so the browser allows the microphone). Others are typed by the doctor.
                    if (code && getLanguage(code).voice) startVoice(code)
                    else intake.stop()
                  }}
                  items={LANGUAGES.map((l) => ({ value: l.code, label: l.englishName }))}
                >
                  <SelectTrigger id="np-language" className="w-full rounded-sm" aria-invalid={!!errors.language || undefined}>
                    <SelectValue placeholder={t("newPatient.languagePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.englishName}
                        {l.code !== "en" && (
                          <span lang={l.code} dir={l.dir} className="text-muted-foreground">
                            {l.nativeName}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {slot("language", t("newPatient.languageHint"))}
              </Field>

              {/* Languages without voice coverage are never offered for voice interpretation. */}
              {lang && !lang.voice && (
                <div role="note" className="flex gap-2 rounded-sm border border-caution/40 bg-caution-soft p-2.5 text-xs text-caution">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p>{t("newPatient.noVoice", { language: lang.englishName })}</p>
                </div>
              )}

              <FieldSet className="gap-2">
                <FieldLegend variant="label">{t("newPatient.communication")}</FieldLegend>
                <Field orientation="horizontal">
                  <Checkbox id="np-read" checked={draft.canRead} onCheckedChange={(v) => set("canRead", v === true)} />
                  <FieldLabel htmlFor="np-read" className="font-normal">
                    {t("newPatient.canRead")}
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="np-companion" checked={draft.companion} onCheckedChange={(v) => set("companion", v === true)} />
                  <FieldLabel htmlFor="np-companion" className="font-normal">
                    {t("newPatient.companion")}
                  </FieldLabel>
                </Field>
              </FieldSet>
            </FieldGroup>
          ) : current === "health" ? (
            <FieldGroup className="gap-3">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="np-allergies">{t("newPatient.allergies")}</FieldLabel>
                <Input
                  id="np-allergies"
                  autoComplete="off"
                  placeholder={t("newPatient.allergiesPlaceholder")}
                  value={draft.allergies}
                  onChange={(e) => set("allergies", e.target.value)}
                />
                <FieldDescription className="text-xs">{said("allergies") ?? t("newPatient.allergiesHint")}</FieldDescription>
              </Field>
              <FieldSet className="gap-2">
                <FieldLegend variant="label">{t("newPatient.conditions")}</FieldLegend>
                <div className="grid grid-cols-2 gap-2">
                  {CONDITIONS.map((c) => (
                    <Field key={c} orientation="horizontal">
                      <Checkbox
                        id={`np-c-${c}`}
                        checked={draft.conditions.includes(c)}
                        onCheckedChange={(v) =>
                          set("conditions", v === true ? [...draft.conditions, c] : draft.conditions.filter((x) => x !== c))
                        }
                      />
                      <FieldLabel htmlFor={`np-c-${c}`} className="font-normal">
                        {t(`newPatient.condition.${c}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
                {said("conditions") && <FieldDescription className="text-xs">{said("conditions")}</FieldDescription>}
              </FieldSet>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="np-medicines">{t("newPatient.medicines")}</FieldLabel>
                <Input
                  id="np-medicines"
                  autoComplete="off"
                  placeholder={t("newPatient.medicinesPlaceholder")}
                  value={draft.medicines}
                  onChange={(e) => set("medicines", e.target.value)}
                />
                {said("medicines") && <FieldDescription className="text-xs">{said("medicines")}</FieldDescription>}
              </Field>
            </FieldGroup>
          ) : (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 rounded-sm border p-3 text-sm">
                <Row label={t("auth.fullName")}>{draft.name.trim()}</Row>
                <Row label={t("newPatient.ageSex")}>
                  {t("patients.ageSex", { age: draft.age, sex: draft.sex ? t(`patients.sex.${draft.sex}`) : "" })}
                </Row>
                <Row label={t("newPatient.phone")}>{maskPhone(draft.phone)}</Row>
                <Row label={t("newPatient.language")}>
                  {lang?.englishName}
                  {lang && !lang.voice && <span className="text-caution"> · {t("newPatient.pictureMode")}</span>}
                </Row>
                <Row label={t("newPatient.allergies")}>{draft.allergies.trim() || t("newPatient.noneRecorded")}</Row>
                <Row label={t("newPatient.conditions")}>
                  {draft.conditions.length
                    ? draft.conditions.map((c) => t(`newPatient.condition.${c}`)).join(", ")
                    : t("newPatient.noneRecorded")}
                </Row>
                <Row label={t("newPatient.medicines")}>{draft.medicines.trim() || t("newPatient.noneRecorded")}</Row>
              </dl>

              <FieldSet className="gap-2" data-invalid={!!errors.consent || undefined}>
                <FieldLegend variant="label">{t("newPatient.consent")}</FieldLegend>
                <RadioGroup value={draft.consent} onValueChange={(v) => set("consent", v as Consent)} aria-invalid={!!errors.consent || undefined}>
                  {(["given", "declined"] as const).map((c) => (
                    <Label key={c} className="items-start font-normal">
                      <RadioGroupItem value={c} className="mt-0.5" />
                      {t(`newPatient.consentOption.${c}`)}
                    </Label>
                  ))}
                </RadioGroup>
                {slot("consent")}
              </FieldSet>
            </div>
          )}

          <DialogFooter className="mt-3">
            {created === null && (
              <Button type="button" variant="outline" size="sm" onClick={() => (step === 0 ? close(false) : goTo(step - 1))}>
                {step === 0 ? t("common.cancel") : t("newPatient.back")}
              </Button>
            )}
            {saveError && <p className="me-auto self-center text-xs text-destructive">{t("newPatient.saveError")}</p>}
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {primaryLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

// "New patient" wizard, after shadcn.io's stepper-dialog-wizard block (a Dialog
// with a numbered step line, one panel per step, Back + one primary action).
// That block's code is Pro-only, so this is rebuilt from its description.
import { AlertTriangle, CheckIcon } from "lucide-react"
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
import { type SamplePatient, type Sex } from "@/data/sample"
import { getLanguage, LANGUAGES } from "@/i18n/languages"
import { cn } from "@/lib/utils"

const STEPS = ["details", "language", "health", "review"] as const
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

/** Phone shown masked, the way the patients table shows it. */
function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-10)
  return digits ? `+91 ••••• ••${digits.slice(-3)}` : "—"
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  nextId: string
  onCreate: (patient: SamplePatient) => void
}

export function NewPatientDialog({ open, onOpenChange, nextId, onCreate }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [created, setCreated] = useState<string | null>(null)
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([])

  const current = STEPS[step]
  const lang = draft.language ? getLanguage(draft.language) : null

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const reset = () => {
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

  const next = () => {
    if (created) return close(false)
    const e = validate(current, draft)
    setErrors(e)
    if (Object.keys(e).length) return
    if (current !== "review") return goTo(step + 1)
    onCreate({
      id: nextId,
      name: draft.name.trim().replace(/\s+/g, " "),
      age: Number(draft.age),
      sex: draft.sex as Sex,
      phone: maskPhone(draft.phone),
      language: draft.language,
      lastVisit: new Date().toLocaleDateString("en-CA"),
      visits: 0,
      status: "active",
    })
    setCreated(nextId)
  }

  // The step line is one tab stop; arrow keys move between reached steps.
  const onStepKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (created) return
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
  const slot = (key: keyof Draft, hint?: ReactNode) =>
    errors[key] ? <FieldError className="min-h-8 text-xs">{err(key)}</FieldError> : <FieldDescription className="min-h-8 text-xs">{hint}</FieldDescription>

  const primaryLabel = created
    ? t("newPatient.done")
    : current === "review"
      ? t("newPatient.create")
      : t("newPatient.continue")

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newPatient.title")}</DialogTitle>
          <DialogDescription>{t("newPatient.description")}</DialogDescription>
        </DialogHeader>

        {/* Step line: numbered circles joined by a line; labels hidden on phones. */}
        <ol aria-label={t("newPatient.steps")} onKeyDown={onStepKey} className="flex items-center">
          {STEPS.map((s, i) => {
            const done = i < step || created !== null
            const active = i === step && !created
            const reachable = i <= reached && !created
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
                  <span aria-hidden="true" className={cn("mx-2 h-px flex-1", i < step || created ? "bg-primary" : "bg-border")} />
                )}
              </li>
            )
          })}
        </ol>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            next()
          }}
          className="min-h-72"
        >
          {created ? (
            <div role="status" className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckIcon className="size-5" aria-hidden="true" />
              </span>
              <p className="font-medium">{t("newPatient.created", { name: draft.name.trim(), id: created })}</p>
              <p className="max-w-xs text-xs text-muted-foreground">{t("newPatient.demoNote")}</p>
            </div>
          ) : current === "details" ? (
            <FieldGroup className="gap-3">
              <Field className="gap-1.5" data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="np-name">{t("auth.fullName")}</FieldLabel>
                <Input
                  id="np-name"
                  autoFocus
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
            <FieldGroup className="gap-4">
              <Field className="gap-1.5" data-invalid={!!errors.language || undefined}>
                <FieldLabel htmlFor="np-language">{t("newPatient.language")}</FieldLabel>
                <Select
                  value={draft.language || null}
                  onValueChange={(v) => set("language", (v as string) ?? "")}
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
                <div role="note" className="flex gap-2 rounded-sm border border-caution/40 bg-caution-soft p-3 text-xs text-caution">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p>{t("newPatient.noVoice", { language: lang.englishName })}</p>
                </div>
              )}

              <FieldSet className="gap-3">
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
            <FieldGroup className="gap-4">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="np-allergies">{t("newPatient.allergies")}</FieldLabel>
                <Input
                  id="np-allergies"
                  autoComplete="off"
                  placeholder={t("newPatient.allergiesPlaceholder")}
                  value={draft.allergies}
                  onChange={(e) => set("allergies", e.target.value)}
                />
                <FieldDescription className="text-xs">{t("newPatient.allergiesHint")}</FieldDescription>
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
              </Field>
            </FieldGroup>
          ) : (
            <div className="flex flex-col gap-4">
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

          <DialogFooter className="mt-4">
            {!created && (
              <Button type="button" variant="outline" size="sm" onClick={() => (step === 0 ? close(false) : goTo(step - 1))}>
                {step === 0 ? t("common.cancel") : t("newPatient.back")}
              </Button>
            )}
            <Button type="submit" size="sm">
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

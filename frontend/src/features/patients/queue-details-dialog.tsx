import { Loader2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { QUEUE_STATUSES, type PatientRow, type QueuePatch, type QueueStatus } from "./patients-api"
import { PRIORITY_OPTIONS } from "./queue-meta"

/** ISO → value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Props = {
  patient: PatientRow | null
  clinics: string[]
  onOpenChange: (open: boolean) => void
  onSave: (patient: PatientRow, patch: QueuePatch) => Promise<void>
}

/** Doctor-set queue details: reason, clinic, priority, status and due time. */
export function QueueDetailsDialog({ patient, clinics, onOpenChange, onSave }: Props) {
  return (
    <Dialog open={patient !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-md">
        {/* Keyed so the form starts from the chosen patient's values each time. */}
        {patient && <DetailsForm key={patient.id} patient={patient} clinics={clinics} onOpenChange={onOpenChange} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({ patient, clinics, onOpenChange, onSave }: Props & { patient: PatientRow }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState(patient.reason ?? "")
  const [clinic, setClinic] = useState(patient.clinic ?? "")
  const [priority, setPriority] = useState<string>(patient.priority ?? "none")
  const [status, setStatus] = useState<QueueStatus>(patient.queue_status)
  const [due, setDue] = useState(toLocalInput(patient.due_at))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const submit = async () => {
    setSaving(true)
    setError(false)
    try {
      await onSave(patient, {
        reason: reason.trim() || null,
        clinic: clinic.trim() || null,
        priority: priority === "none" ? null : (priority as PatientRow["priority"]),
        queue_status: status,
        due_at: due ? new Date(due).toISOString() : null,
      })
      onOpenChange(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("queue.editTitle", { name: patient.full_name })}</DialogTitle>
        <DialogDescription>{t("queue.editHint")}</DialogDescription>
      </DialogHeader>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <FieldGroup className="gap-3">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="q-reason">{t("queue.col.reason")}</FieldLabel>
            <Input
              id="q-reason"
              maxLength={200}
              placeholder={t("queue.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="q-clinic">{t("queue.clinic")}</FieldLabel>
            <Input id="q-clinic" list="q-clinics" maxLength={80} value={clinic} onChange={(e) => setClinic(e.target.value)} />
            <datalist id="q-clinics">
              {clinics.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <FieldSet className="gap-1.5">
            <FieldLegend variant="label" className="mb-0">
              {t("queue.priorityLabel")}
            </FieldLegend>
            <RadioGroup value={priority} onValueChange={(v) => setPriority(v as string)} className="flex flex-wrap gap-x-4 gap-y-2">
              {PRIORITY_OPTIONS.map((o) => (
                <Label key={o} className="font-normal">
                  <RadioGroupItem value={o} />
                  {t(`queue.priority.${o}`)}
                </Label>
              ))}
            </RadioGroup>
            <FieldDescription className="text-xs">{t("queue.priorityHint")}</FieldDescription>
          </FieldSet>
          <div className="grid grid-cols-2 gap-3">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="q-status">{t("queue.col.status")}</FieldLabel>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as QueueStatus)}
                items={QUEUE_STATUSES.map((s) => ({ value: s, label: t(`queue.status.${s}`) }))}
              >
                <SelectTrigger id="q-status" className="w-full rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUEUE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`queue.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="q-due">{t("queue.col.due")}</FieldLabel>
              <Input id="q-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter className="mt-4">
          {error && <p className="me-auto self-center text-xs text-destructive">{t("newPatient.saveError")}</p>}
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t("queue.save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

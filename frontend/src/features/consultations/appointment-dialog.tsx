import { Stethoscope } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { APPOINTMENT_STATUSES, findDoctor, type AppointmentStatus, type SampleAppointment } from "@/data/appointments"
import { findPatient } from "@/data/sample"
import { AppointmentStatusBadge } from "@/features/consultations/columns"
import { formatShortDate, formatTimeSlot } from "@/lib/format"

/**
 * Transparent fill with a multi-colour gradient border: the gradient is painted
 * on a pseudo-element and masked down to a 1px ring, so the button stays see-through.
 */
const GRADIENT_BORDER =
  "relative before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:p-px before:bg-linear-to-r before:from-sky-500 before:via-fuchsia-500 before:to-amber-400 before:content-[''] before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]"

type Props = {
  appointment: SampleAppointment | null
  onOpenChange: (open: boolean) => void
  onStatusChange: (id: string, status: AppointmentStatus) => void
}

export function AppointmentDialog({ appointment, onOpenChange, onStatusChange }: Props) {
  const { t, i18n } = useTranslation()
  const [reportRequested, setReportRequested] = useState(false)

  const close = (open: boolean) => {
    onOpenChange(open)
    if (!open) setReportRequested(false)
  }

  const patient = appointment ? findPatient(appointment.patientId) : undefined
  const doctor = appointment ? findDoctor(appointment.doctorId) : undefined

  return (
    <Dialog open={appointment !== null} onOpenChange={close}>
      <DialogContent className="gap-5 sm:max-w-md">
        {appointment && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {t("consultations.dialog.title")}
                <AppointmentStatusBadge status={appointment.status} />
              </DialogTitle>
              <DialogDescription>{t("consultations.dialog.description")}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 rounded-sm border p-3 text-sm">
              <Row label={t("consultations.col.id")}>
                <span className="font-mono text-xs">{appointment.id}</span>
              </Row>
              <Row label={t("consultations.col.patientId")}>
                <span className="font-mono text-xs">{appointment.patientId}</span>
              </Row>
              <Row label={t("consultations.dialog.patientName")}>{patient?.name ?? "—"}</Row>
              <Row label={t("consultations.dialog.doctorId")}>
                <span className="font-mono text-xs">{appointment.doctorId}</span>
              </Row>
              <Row label={t("consultations.dialog.doctorName")}>{doctor?.name ?? "—"}</Row>
              <Row label={t("consultations.dialog.department")}>
                {doctor ? t(`consultations.department.${doctor.department}`) : "—"}
              </Row>
              <Row label={t("consultations.col.date")}>{formatShortDate(appointment.date, i18n.language)}</Row>
              <Row label={t("consultations.col.timeSlot")}>
                <span className="tabular-nums">{formatTimeSlot(appointment.start, appointment.end, i18n.language)}</span>
              </Row>
            </dl>

            <Field className="gap-1.5">
              <FieldLabel htmlFor="apt-status">{t("consultations.dialog.setStatus")}</FieldLabel>
              <Select
                value={appointment.status}
                onValueChange={(v) => {
                  if (v) onStatusChange(appointment.id, v as AppointmentStatus)
                }}
                items={APPOINTMENT_STATUSES.map((s) => ({ value: s, label: t(`consultations.status.${s}`) }))}
              >
                <SelectTrigger id="apt-status" className="w-full rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`consultations.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <DialogFooter className="items-center">
              {reportRequested && (
                <p role="status" className="me-auto text-xs text-muted-foreground">
                  {t("consultations.dialog.reportUnavailable")}
                </p>
              )}
              {/* No backend yet: the report is generated in a later phase. */}
              <Button variant="ghost" size="sm" className={GRADIENT_BORDER} onClick={() => setReportRequested(true)}>
                {t("consultations.dialog.generateReport")}
                <Stethoscope data-icon="inline-end" />
              </Button>
            </DialogFooter>
          </>
        )}
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

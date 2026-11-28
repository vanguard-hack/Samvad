import { CalendarPlus, Loader2, UserPlus, Video } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SampleAppointment } from "@/data/appointments"
import { daysAgo } from "@/data/sample"
import { addMinutes, bookAppointment, listDoctors, toMinutes, type BookingDraft, type DoctorSlot } from "@/features/consultations/booking-api"
import { useNow } from "@/features/consultations/calendar-utils"
import { listPatients, patientCode, type PatientRow } from "@/features/patients/patients-api"
import { formatClock, formatTimeSlot, formatWeekdayDate } from "@/lib/format"

/** Suggested times: every 10 minutes, all day. Any other time can be typed. */
const TIMES = Array.from({ length: 144 }, (_, i) => addMinutes("00:00", i * 10))
const DURATIONS = [5, 10, 15, 30, 45, 60] as const
const MAX_MINUTES = 240 // the backend's longest slot

type Props = {
  /** The slot (and maybe patient) to start from; null closes the dialog. */
  draft: BookingDraft | null
  onOpenChange: (open: boolean) => void
  onBooked: (appointment: SampleAppointment) => void
}

/** Consultations → slot → patient → a free doctor → book (Google Meet link emailed to the signed-in user). */
export function BookingDialog({ draft, onOpenChange, onBooked }: Props) {
  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        {/* Keyed by the draft, so each opening starts fresh. */}
        {draft && <BookingForm key={`${draft.date}${draft.start}${draft.patientId ?? ""}`} draft={draft} onBooked={onBooked} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function BookingForm({ draft, onBooked, onClose }: { draft: BookingDraft; onBooked: Props["onBooked"]; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()

  const [date, setDate] = useState(draft.date)
  const [start, setStart] = useState(draft.start)
  const [end, setEnd] = useState(() => addMinutes(draft.start, 30))
  const [patientId, setPatientId] = useState(draft.patientId ?? "")
  const [doctorId, setDoctorId] = useState("")
  const [notes, setNotes] = useState("")

  // The slot as typed or picked: end after start, at most MAX_MINUTES long.
  const length = toMinutes(end) - toMinutes(start)
  const slotError = !start || !end || Number.isNaN(length)
    ? t("consultations.booking.enterTimes")
    : length <= 0
      ? t("consultations.booking.endBeforeStart")
      : length > MAX_MINUTES
        ? t("consultations.booking.tooLong", { count: MAX_MINUTES })
        : null
  const preset = DURATIONS.find((m) => m === length)
  // Moving the start keeps the length, so the end follows it.
  const changeStart = (value: string) => {
    setStart(value)
    if (toMinutes(value) >= 0 && length > 0) setEnd(addMinutes(value, length))
  }

  const [patients, setPatients] = useState<PatientRow[] | null>(null)
  const [patientsError, setPatientsError] = useState(false)
  // The doctors answer for one slot + patient; another key means it is still loading.
  const slotKey = `${date}|${start}|${end}|${patientId}`
  const [result, setResult] = useState<{ key: string; doctors?: DoctorSlot[]; error?: string } | null>(null)
  const doctors = result?.key === slotKey ? (result.doctors ?? null) : null
  const doctorsError = result?.key === slotKey ? (result.error ?? null) : null
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<SampleAppointment | null>(null)

  useEffect(() => {
    listPatients()
      .then(setPatients)
      .catch(() => setPatientsError(true))
  }, [])

  // Doctors for this slot (free or busy), recommended for this patient; pick the best free one.
  useEffect(() => {
    if (!date || slotError) return
    const controller = new AbortController()
    const key = `${date}|${start}|${end}|${patientId}`
    listDoctors({ date, start, end }, patientId || null, controller.signal)
      .then(({ doctors: list }) => {
        setResult({ key, doctors: list })
        setDoctorId((current) => {
          if (list.some((d) => d.id === current && d.available)) return current
          return list.find((d) => d.available)?.id ?? ""
        })
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setResult({ key, error: err.message })
      })
    return () => controller.abort()
  }, [date, start, end, patientId, slotError])

  const patient = patients?.find((p) => p.id === patientId)
  const doctor = doctors?.find((d) => d.id === doctorId)
  const now = useNow()
  const inPast = useMemo(() => new Date(`${date}T${start}`) <= now, [date, start, now])
  const canBook = !!date && !slotError && !!patient && !!doctor?.available && !inPast && !booking

  const book = async () => {
    if (!canBook) return
    setBooking(true)
    setError(null)
    try {
      const appointment = await bookAppointment({ date, start, end, patientId, doctorId, notes: notes.trim() || undefined })
      setBooked(appointment)
      onBooked(appointment)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBooking(false)
    }
  }

  // "New patient": register them on the Patients page, then come back here with them selected.
  const newPatient = () => {
    onClose()
    navigate("/", { state: { newPatientForBooking: { date, start } satisfies BookingDraft } })
  }

  if (booked) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("consultations.booking.bookedTitle")}</DialogTitle>
          <DialogDescription>
            {t("consultations.booking.bookedBody", {
              id: booked.id,
              patient: booked.patient?.name ?? booked.patientId,
              doctor: booked.doctor?.name ?? booked.doctorId,
              when: `${formatWeekdayDate(booked.date, lang)}, ${formatTimeSlot(booked.start, booked.end, lang)}`,
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {booked.attendees?.length
            ? t("consultations.booking.invited", { email: booked.attendees.join(", ") })
            : t("consultations.booking.notInvited")}
        </p>
        <DialogFooter>
          {booked.meetingLink && (
            <Button variant="outline" render={<a href={booked.meetingLink} target="_blank" rel="noreferrer" />} nativeButton={false}>
              <Video />
              {t("consultations.booking.openMeet")}
            </Button>
          )}
          <Button onClick={onClose}>{t("consultations.booking.done")}</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarPlus className="size-4" />
          {t("consultations.booking.title")}
        </DialogTitle>
        <DialogDescription>{t("consultations.booking.description")}</DialogDescription>
      </DialogHeader>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="book-date">{t("consultations.booking.date")}</FieldLabel>
        <Input id="book-date" type="date" min={daysAgo(0)} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {/* Times: pick from the 10-minute list or type any time; the length sets the end, or set the end yourself. */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="book-start">{t("consultations.booking.start")}</FieldLabel>
          <Input id="book-start" type="time" list="book-times" value={start} onChange={(e) => changeStart(e.target.value)} />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="book-end">{t("consultations.booking.end")}</FieldLabel>
          <Input id="book-end" type="time" list="book-end-times" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="book-duration">{t("consultations.booking.duration")}</FieldLabel>
          <Select
            value={preset ? String(preset) : "custom"}
            onValueChange={(v) => v && v !== "custom" && start && setEnd(addMinutes(start, Number(v)))}
            items={[
              ...DURATIONS.map((m) => ({ value: String(m), label: t("consultations.booking.minutes", { count: m }) })),
              { value: "custom", label: t("consultations.booking.custom") },
            ]}
          >
            <SelectTrigger id="book-duration" className="w-28 rounded-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {t("consultations.booking.minutes", { count: m })}
                </SelectItem>
              ))}
              <SelectItem value="custom" disabled>
                {t("consultations.booking.custom")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <datalist id="book-times">
          {TIMES.map((time) => (
            <option key={time} value={time} label={formatClock(time, lang)} />
          ))}
        </datalist>
        <datalist id="book-end-times">
          {TIMES.filter((time) => toMinutes(time) > toMinutes(start)).map((time) => (
            <option key={time} value={time} label={formatClock(time, lang)} />
          ))}
        </datalist>
      </div>
      {slotError ? (
        <p className="-mt-2 text-xs text-danger">{slotError}</p>
      ) : (
        <p className="-mt-2 text-xs text-muted-foreground">
          {formatTimeSlot(start, end, lang)} · {t("consultations.booking.minutes", { count: length })}
        </p>
      )}
      {inPast && <p className="-mt-2 text-xs text-danger">{t("consultations.booking.pastSlot")}</p>}

      <Field className="gap-1.5">
        <FieldLabel htmlFor="book-patient">{t("consultations.booking.patient")}</FieldLabel>
        <div className="flex gap-2">
          <Select
            value={patientId}
            onValueChange={(v) => setPatientId(v ?? "")}
            items={(patients ?? []).map((p) => ({ value: p.id, label: `${p.full_name} · ${patientCode(p.patient_number)}` }))}
          >
            <SelectTrigger id="book-patient" className="min-w-0 flex-1 rounded-sm" disabled={!patients?.length}>
              <SelectValue placeholder={patients === null && !patientsError ? t("consultations.booking.loading") : t("consultations.booking.pickPatient")} />
            </SelectTrigger>
            <SelectContent>
              {(patients ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name} · {patientCode(p.patient_number)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={newPatient}>
            <UserPlus />
            {t("consultations.booking.newPatient")}
          </Button>
        </div>
        {patientsError && <FieldDescription className="text-danger">{t("consultations.booking.patientsError")}</FieldDescription>}
        {patients?.length === 0 && <FieldDescription>{t("consultations.booking.noPatients")}</FieldDescription>}
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="book-doctor">{t("consultations.booking.doctor")}</FieldLabel>
        <Select
          value={doctorId}
          onValueChange={(v) => setDoctorId(v ?? "")}
          items={(doctors ?? []).map((d) => ({ value: d.id, label: doctorLabel(d) }))}
        >
          <SelectTrigger id="book-doctor" className="w-full rounded-sm" disabled={!doctors}>
            <SelectValue placeholder={doctors === null && !doctorsError ? t("consultations.booking.checking") : t("consultations.booking.pickDoctor")} />
          </SelectTrigger>
          <SelectContent>
            {(doctors ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id} disabled={!d.available}>
                {doctorLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {doctorsError && <FieldDescription className="text-danger">{doctorsError}</FieldDescription>}
        {doctors && !doctors.some((d) => d.available) && (
          <FieldDescription className="text-danger">{t("consultations.booking.noneFree")}</FieldDescription>
        )}
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="book-notes">{t("consultations.booking.notes")}</FieldLabel>
        <Input id="book-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("consultations.booking.notesHint")} />
      </Field>

      {error && (
        <p role="alert" className="rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <DialogFooter className="items-center">
        <p className="me-auto text-xs text-muted-foreground">{t("consultations.booking.meetNote")}</p>
        <Button variant="ghost" onClick={onClose}>
          {t("consultations.booking.cancel")}
        </Button>
        <Button onClick={() => void book()} disabled={!canBook}>
          {booking ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
          {t("consultations.booking.book")}
        </Button>
      </DialogFooter>
    </>
  )

  function doctorLabel(d: DoctorSlot) {
    const parts = [d.name, t(`consultations.department.${d.department}`)]
    if (!d.available) parts.push(t("consultations.booking.busy"))
    else if (d.recommended) parts.push(t("consultations.booking.recommended"))
    return parts.join(" · ")
  }
}

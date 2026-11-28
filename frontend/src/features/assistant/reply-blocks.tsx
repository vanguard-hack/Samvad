import { animate, motion, useReducedMotion } from "motion/react"
import { Building2, CalendarDays, ChevronRight, Languages, Stethoscope, UserRound } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/data/appointments"
import { useAssistant } from "@/features/assistant/assistant-context"
import type { AppointmentFilters, ReplyBlock } from "@/features/assistant/types"
import { useMessageText } from "@/features/assistant/use-message-text"
import { AppointmentStatusBadge } from "@/features/consultations/columns"
import { PATIENT_STATUS_BADGE } from "@/features/patients/patient-status-badge"
import { getLanguage } from "@/i18n/languages"
import { EASE_OUT } from "@/lib/ease"
import { formatClock, formatShortDate, formatTimeSlot, formatWeekdayDate } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Rows shown before "Show more". */
const COLLAPSED_ROWS = 5

/** Bar and dot colours per status; caution is kept for "needs review", as in the badges. */
const STATUS_FILL: Record<AppointmentStatus, string> = {
  scheduled: "bg-muted-foreground/40",
  active: "bg-foreground/75",
  needsReview: "bg-caution",
  followUp: "bg-primary",
  closed: "bg-border",
}

/** Words the engine reads for "only <status>" follow-ups. */
const STATUS_QUERY: Record<AppointmentStatus, string> = {
  scheduled: "scheduled",
  active: "active",
  needsReview: "need review",
  followUp: "follow-up",
  closed: "closed",
}

function useEnter(index = 0) {
  const reduced = useReducedMotion()
  return reduced
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: EASE_OUT, delay: 0.15 + index * 0.05 },
      }
}

// ── Filter chips ───────────────────────────────────────────────────────────

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Badge variant="outline" className="gap-1 bg-background/60 font-normal text-muted-foreground">
      {icon}
      {children}
    </Badge>
  )
}

/** The context an answer used, so the doctor sees what "and tomorrow?" built on. */
export function FilterChips({ filters }: { filters: AppointmentFilters }) {
  const { t } = useTranslation()
  const { range } = useMessageText()
  const { data } = useAssistant()
  const patient = data.patients.find((p) => p.id === filters.patientId)
  const doctor = data.doctors.find((d) => d.id === filters.doctorId)

  const chips = [
    filters.range && <Chip key="range" icon={<CalendarDays />}>{range(filters.range)}</Chip>,
    patient && <Chip key="patient" icon={<UserRound />}>{patient.name}</Chip>,
    doctor && <Chip key="doctor" icon={<Stethoscope />}>{doctor.name}</Chip>,
    filters.department && (
      <Chip key="department" icon={<Building2 />}>
        {t(`consultations.department.${filters.department}`)}
      </Chip>
    ),
    filters.language && <Chip key="language" icon={<Languages />}>{getLanguage(filters.language).englishName}</Chip>,
    ...(filters.status ?? []).map((s) => <AppointmentStatusBadge key={s} status={s} />),
  ].filter(Boolean)

  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("assistant.filters")}>
      {chips}
    </div>
  )
}

// ── Appointments ───────────────────────────────────────────────────────────

function AppointmentList({ ids }: { ids: string[] }) {
  const { t, i18n } = useTranslation()
  const { data, openAppointment } = useAssistant()
  const [expanded, setExpanded] = useState(false)
  const enter = useEnter()
  const reduced = useReducedMotion()
  const rows = ids.map((id) => data.appointments.find((a) => a.id === id)).filter((a) => a !== undefined)
  // Folding away a single row saves nothing, so only longer lists collapse.
  const collapsible = rows.length > COLLAPSED_ROWS + 1
  const shown = expanded || !collapsible ? rows : rows.slice(0, COLLAPSED_ROWS)
  const hidden = rows.length - shown.length
  const lng = i18n.language

  return (
    <motion.div {...enter} className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        {shown.map((a, i) => {
          // The appointment carries its patient and doctor as booked.
          const patient = a.patient ?? data.patients.find((p) => p.id === a.patientId)
          const doctor = a.doctor ?? data.doctors.find((d) => d.id === a.doctorId)
          return (
            <motion.li
              key={a.id}
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT, delay: reduced ? 0 : 0.2 + Math.min(i, COLLAPSED_ROWS) * 0.045 }}
            >
              <button
                type="button"
                onClick={() => openAppointment(a.id)}
                aria-label={`${t("consultations.open")}: ${a.id}, ${patient?.name ?? a.patientId}`}
                className="group flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-offset-[-2px]"
              >
                <div className="w-16 shrink-0 tabular-nums sm:w-20">
                  <div className="text-sm font-medium">{formatClock(a.start, lng)}</div>
                  <div className="truncate text-xs text-muted-foreground">{formatWeekdayDate(a.date, lng)}</div>
                </div>
                <span aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium">{patient?.name ?? a.patientId}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground max-sm:hidden">{a.id}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[doctor?.name, doctor && t(`consultations.department.${doctor.department}`), getLanguage(a.language).englishName]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {/* Phones: the status moves under the name so the name keeps its room. */}
                  <div className="mt-1 sm:hidden">
                    <AppointmentStatusBadge status={a.status} />
                  </div>
                </div>
                <span className="max-sm:hidden">
                  <AppointmentStatusBadge status={a.status} />
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100" />
              </button>
            </motion.li>
          )
        })}
      </ul>
      {collapsible && (
        <div className="border-t bg-muted/30 px-2 py-1">
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("assistant.showLess") : t("assistant.showMore", { count: hidden })}
          </Button>
        </div>
      )}
    </motion.div>
  )
}

// ── Summary ────────────────────────────────────────────────────────────────

function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? value : 0)
  useEffect(() => {
    if (reduced) return
    const controls = animate(0, value, { duration: 0.9, ease: EASE_OUT, onUpdate: (v) => setShown(Math.round(v)) })
    return () => controls.stop()
  }, [value, reduced])
  return <>{reduced ? value : shown}</>
}

function SummaryBlock({ block }: { block: Extract<ReplyBlock, { type: "summary" }> }) {
  const { t } = useTranslation()
  const { ask, pending } = useAssistant()
  const enter = useEnter()
  const reduced = useReducedMotion()
  const tiles = [
    { key: "total", value: block.total },
    { key: "patients", value: block.patients },
    { key: "doctors", value: block.doctors },
  ]

  return (
    <motion.div {...enter} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="text-display font-semibold tracking-display tabular-nums">
              <CountUp value={tile.value} />
            </div>
            <div className="text-xs text-muted-foreground">{t(`assistant.summary.${tile.key}`)}</div>
          </div>
        ))}
      </div>

      {block.total > 0 && (
        <>
          <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("assistant.summary.byStatus")}>
            {APPOINTMENT_STATUSES.filter((s) => block.byStatus[s] > 0).map((s, i) => (
              <motion.span
                key={s}
                className={cn("h-full first:rounded-s-full last:rounded-e-full", STATUS_FILL[s])}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${(block.byStatus[s] / block.total) * 100}%` }}
                transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.25 + i * 0.06 }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-1">
            {APPOINTMENT_STATUSES.filter((s) => block.byStatus[s] > 0).map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    ask(t("assistant.suggest.onlyStatus", { status: t(`consultations.status.${s}`) }), `only those ${STATUS_QUERY[s]}`)
                  }
                  className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <span aria-hidden="true" className={cn("size-2 rounded-full", STATUS_FILL[s])} />
                  {t(`consultations.status.${s}`)}
                  <span className="font-medium text-foreground tabular-nums">{block.byStatus[s]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  )
}

// ── Free slots ─────────────────────────────────────────────────────────────

function SlotsBlock({ block }: { block: Extract<ReplyBlock, { type: "slots" }> }) {
  const { t, i18n } = useTranslation()
  const { data } = useAssistant()
  const enter = useEnter()
  const lng = i18n.language

  return (
    <motion.div {...enter} className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        {block.rows.map((row) => {
          const doctor = data.doctors.find((d) => d.id === row.doctorId)
          return (
            <li key={row.doctorId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
              <div className="w-44 shrink-0">
                <div className="truncate text-sm font-medium">{doctor?.name ?? row.doctorId}</div>
                {doctor && <div className="text-xs text-muted-foreground">{t(`consultations.department.${doctor.department}`)}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.slots.length ? (
                  row.slots.map((s) => (
                    <span
                      key={s.start}
                      className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary tabular-nums"
                    >
                      {formatTimeSlot(s.start, s.end, lng)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">{t("assistant.slots.none")}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">{t("assistant.slots.hours")}</p>
    </motion.div>
  )
}

// ── Patient ────────────────────────────────────────────────────────────────

function PatientBlock({ block }: { block: Extract<ReplyBlock, { type: "patient" }> }) {
  const { t, i18n } = useTranslation()
  const { data } = useAssistant()
  const enter = useEnter()
  const patient = data.patients.find((p) => p.id === block.patientId)
  if (!patient) return null
  const badge = PATIENT_STATUS_BADGE[patient.status]
  const initials = patient.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")

  const facts = [
    { label: t("patients.col.language"), value: getLanguage(patient.language).englishName },
    { label: t("patients.col.visits"), value: patient.visits },
    { label: t("patients.col.lastVisit"), value: formatShortDate(patient.lastVisit, i18n.language) },
  ]

  return (
    <motion.div {...enter} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex items-center gap-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-sky-500 via-fuchsia-500 to-amber-400 p-[1.5px]">
          <span className="grid size-full place-items-center rounded-full bg-card text-sm font-semibold">{initials}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{patient.name}</span>
            <Badge variant={badge.variant} className={badge.className}>
              {t(`patients.status.${patient.status}`)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{patient.id}</span> ·{" "}
            {t("patients.ageSex", { age: patient.age, sex: t(`patients.sex.${patient.sex}`) })}
          </div>
        </div>
        <Button variant="outline" size="sm" render={<Link to={`/patients/${patient.id}`} />} nativeButton={false}>
          {t("patients.open")}
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {facts.map((f) => (
          <div key={f.label} className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="truncate text-sm font-medium tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  )
}

// ── Doctors ────────────────────────────────────────────────────────────────

function DoctorsBlock({ block }: { block: Extract<ReplyBlock, { type: "doctors" }> }) {
  const { t } = useTranslation()
  const { data } = useAssistant()
  const enter = useEnter()
  const max = Math.max(1, ...block.rows.map((r) => r.count))
  const reduced = useReducedMotion()

  if (!block.rows.length) return null
  return (
    <motion.ul {...enter} className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {block.rows.map((row, i) => {
        const doctor = data.doctors.find((d) => d.id === row.doctorId)
        return (
          <li key={row.doctorId} className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <Stethoscope className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{doctor?.name ?? row.doctorId}</div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${(row.count / max) * 100}%` }}
                  transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.25 + i * 0.06 }}
                />
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {doctor && t(`consultations.department.${doctor.department}`)}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              {t("assistant.appointmentsCount", { count: row.count })}
            </Badge>
          </li>
        )
      })}
    </motion.ul>
  )
}

export function ReplyBlockView({ block }: { block: ReplyBlock }) {
  switch (block.type) {
    case "appointments":
      return <AppointmentList ids={block.ids} />
    case "summary":
      return <SummaryBlock block={block} />
    case "slots":
      return <SlotsBlock block={block} />
    case "patient":
      return <PatientBlock block={block} />
    case "doctors":
      return <DoctorsBlock block={block} />
  }
}

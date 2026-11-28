import { ChevronLeft, ChevronRight, Globe } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { Department, SampleAppointment } from "@/data/appointments"
import { formatTimeSlot, formatWeekdayDate, intlLocale } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  DEPARTMENTS,
  DEPARTMENT_COLORS,
  addDays,
  appointmentMeta,
  appointmentStart,
  byStart,
  groupByDate,
  isSameDay,
  isoDate,
  monthGrid,
  timezoneOffset,
  weekdayLabels,
} from "./calendar-utils"

/** Upcoming consultations listed under "Up next". */
const UP_NEXT_LIMIT = 4

// ── Mini month ───────────────────────────────────────────────────────────────

export function MiniCalendar({
  month,
  now,
  selected,
  appointments,
  onMonth,
  onSelect,
}: {
  month: Date
  now: Date
  selected: Date
  appointments: SampleAppointment[]
  onMonth: (dir: 1 | -1) => void
  onSelect: (day: Date) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const byDay = useMemo(() => groupByDate(appointments), [appointments])
  const full = new Intl.DateTimeFormat(intlLocale(lang), { weekday: "long", day: "numeric", month: "long" })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon-xs" onClick={() => onMonth(-1)} aria-label={t("consultations.calendar.previous")}>
          <ChevronLeft className="rtl:-scale-x-100" />
        </Button>
        <span className="text-sm font-medium">{new Intl.DateTimeFormat(intlLocale(lang), { month: "long", year: "numeric" }).format(month)}</span>
        <Button variant="ghost" size="icon-xs" onClick={() => onMonth(1)} aria-label={t("consultations.calendar.next")}>
          <ChevronRight className="rtl:-scale-x-100" />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {weekdayLabels(lang, "mini").map((name, i) => (
          <span key={i} className="py-1">
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {monthGrid(month).map((day) => {
          // One dot per department booked that day, like the references' category dots.
          const departments = [...new Set((byDay.get(isoDate(day)) ?? []).map((a) => appointmentMeta(a).department))].slice(0, 3)
          const today = isSameDay(day, now)
          const isSelected = isSameDay(day, selected)
          const outside = day.getMonth() !== month.getMonth()
          return (
            <button
              key={isoDate(day)}
              type="button"
              onClick={() => onSelect(day)}
              aria-label={full.format(day)}
              aria-current={today ? "date" : undefined}
              className={cn(
                "flex h-9 flex-col items-center gap-1 rounded-lg pt-1.5 text-xs tabular-nums transition-colors",
                today
                  ? "bg-foreground font-medium text-background"
                  : isSelected
                    ? "bg-muted font-medium"
                    : outside
                      ? "text-muted-foreground/60 hover:bg-muted"
                      : "hover:bg-muted",
              )}
            >
              {day.getDate()}
              <span className="flex h-1 gap-0.5">
                {departments.map((d) => (
                  <span key={d} className={cn("size-1 rounded-full", DEPARTMENT_COLORS[d].dot)} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Department filters ───────────────────────────────────────────────────────

export function DepartmentFilter({ visible, onChange }: { visible: Set<Department>; onChange: (next: Set<Department>) => void }) {
  const { t } = useTranslation()
  const all = visible.size === DEPARTMENTS.length
  const toggle = (d: Department) => {
    const next = new Set(visible)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold">{t("consultations.calendar.filters")}</p>
      <Label className="font-normal">
        <Checkbox
          checked={all}
          indeterminate={!all && visible.size > 0}
          onCheckedChange={() => onChange(all ? new Set() : new Set(DEPARTMENTS))}
          className="data-checked:border-foreground data-checked:bg-foreground data-checked:text-background dark:data-checked:bg-foreground"
        />
        {t("consultations.calendar.all")}
      </Label>
      {DEPARTMENTS.map((d) => (
        <Label key={d} className="font-normal">
          <Checkbox checked={visible.has(d)} onCheckedChange={() => toggle(d)} className={cn("data-checked:text-white", DEPARTMENT_COLORS[d].check)} />
          {t(`consultations.department.${d}`)}
        </Label>
      ))}
    </div>
  )
}

// ── Up next ──────────────────────────────────────────────────────────────────

export function UpNext({ appointments, now, onOpen }: { appointments: SampleAppointment[]; now: Date; onOpen: (a: SampleAppointment) => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const upcoming = useMemo(() => appointments.filter((a) => appointmentStart(a) >= now).sort(byStart), [appointments, now])
  const when = (iso: string) => {
    if (iso === isoDate(now)) return t("consultations.calendar.today")
    if (iso === isoDate(addDays(now, 1))) return t("consultations.calendar.tomorrow")
    return formatWeekdayDate(iso, lang)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide uppercase">{t("consultations.calendar.upNext")}</p>
        <span className="text-xs font-semibold tabular-nums">{upcoming.length}</span>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("consultations.calendar.nothingUpNext")}</p>
      ) : (
        upcoming.slice(0, UP_NEXT_LIMIT).map((a) => {
          const { patient, department } = appointmentMeta(a)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen(a)}
              className="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-start shadow-xs transition-colors hover:bg-muted/50"
            >
              <span className={cn("h-8 w-1 shrink-0 rounded-full", DEPARTMENT_COLORS[department].dot)} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{patient}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {when(a.date)} · {formatTimeSlot(a.start, a.end, lang)}
                </span>
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}

export function TimezoneNote() {
  const { t, i18n } = useTranslation()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Globe className="size-3.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] tracking-wide uppercase">{t("consultations.calendar.timezone")}</span>
        <span className="truncate text-xs font-medium text-foreground">
          {timezoneOffset(i18n.language)} · {zone}
        </span>
      </div>
    </div>
  )
}

import { createColumnHelper, type Column, type RowData } from "@tanstack/react-table"
import { ArrowUpDown, Eye } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { type DataTableFeatures } from "@/components/data-table/data-table-features"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type AppointmentStatus, type SampleAppointment } from "@/data/appointments"
import { getLanguage } from "@/i18n/languages"
import { formatShortDate, formatTimeSlot } from "@/lib/format"

/** Badge styling by meaning, matching the patients table: caution = needs a human check. */
const APPOINTMENT_STATUS_BADGE: Record<AppointmentStatus, { variant: "secondary" | "default" | "outline"; className?: string }> = {
  scheduled: { variant: "outline" },
  active: { variant: "secondary" },
  needsReview: { variant: "outline", className: "border-caution/40 bg-caution-soft text-caution" },
  followUp: { variant: "outline", className: "border-primary/40 text-primary" },
  closed: { variant: "outline", className: "text-muted-foreground" },
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation()
  const b = APPOINTMENT_STATUS_BADGE[status]
  return (
    <Badge variant={b.variant} className={b.className}>
      {t(`consultations.status.${status}`)}
    </Badge>
  )
}

/** Sortable header, as in the shadcn data-table guide. */
function sortableHeader<TData extends RowData, TValue>(column: Column<DataTableFeatures, TData, TValue>, title: string) {
  return (
    <Button variant="ghost" size="sm" className="-ms-2.5" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {title}
      <ArrowUpDown />
    </Button>
  )
}

const columnHelper = createColumnHelper<DataTableFeatures, SampleAppointment>()

export function useAppointmentColumns(onOpen: (appointment: SampleAppointment) => void) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language

  return useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("id", {
          header: ({ column }) => sortableHeader(column, t("consultations.col.id")),
          cell: ({ getValue }) => <span className="font-mono text-xs font-medium">{getValue()}</span>,
        }),
        columnHelper.accessor("patientId", {
          header: t("consultations.col.patientId"),
          cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>,
        }),
        // Sorts by date, then start time ("2026-11-28 09:00").
        columnHelper.accessor((a) => `${a.date} ${a.start}`, {
          id: "date",
          header: ({ column }) => sortableHeader(column, t("consultations.col.date")),
          cell: ({ row }) => <span className="tabular-nums">{formatShortDate(row.original.date, lng)}</span>,
        }),
        columnHelper.display({
          id: "timeSlot",
          header: t("consultations.col.timeSlot"),
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground tabular-nums">
              {formatTimeSlot(row.original.start, row.original.end, lng)}
            </span>
          ),
        }),
        columnHelper.accessor("language", {
          header: t("consultations.col.language"),
          cell: ({ row }) => <span>{getLanguage(row.original.language).englishName}</span>,
        }),
        columnHelper.accessor("visit", {
          header: ({ column }) => sortableHeader(column, t("consultations.col.visits")),
          cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
        }),
        columnHelper.accessor("status", {
          header: t("consultations.col.status"),
          cell: ({ getValue }) => <AppointmentStatusBadge status={getValue()} />,
        }),
        columnHelper.display({
          id: "actions",
          cell: ({ row }) => (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" onClick={() => onOpen(row.original)} />}
              >
                <Eye />
                <span className="sr-only">{t("consultations.open")}</span>
              </TooltipTrigger>
              <TooltipContent>{t("consultations.open")}</TooltipContent>
            </Tooltip>
          ),
        }),
      ]),
    [t, lng, onOpen],
  )
}

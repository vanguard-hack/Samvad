import { createColumnHelper, type Column, type RowData } from "@tanstack/react-table"
import { ArrowUpDown, Eye } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { type DataTableFeatures } from "@/components/data-table/data-table-features"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type PatientStatus, type SamplePatient } from "@/data/sample"
import { getLanguage } from "@/i18n/languages"
import { daysSince } from "@/lib/format"

/** Badge styling by meaning: caution = needs a human check (safety). */
export const PATIENT_STATUS_BADGE: Record<PatientStatus, { variant: "secondary" | "default" | "outline"; className?: string }> = {
  active: { variant: "secondary" },
  followUp: { variant: "outline", className: "border-primary/40 text-primary" },
  needsReview: { variant: "outline", className: "border-caution/40 bg-caution-soft text-caution" },
}

/** Sortable header, as in the shadcn data-table guide. */
export function sortableHeader<TData extends RowData, TValue>(column: Column<DataTableFeatures, TData, TValue>, title: string) {
  return (
    <Button variant="ghost" size="sm" className="-ms-2.5" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {title}
      <ArrowUpDown />
    </Button>
  )
}

/** Language shown by its English name. */
export function LanguageCell({ code }: { code: string }) {
  return <span>{getLanguage(code).englishName}</span>
}

const columnHelper = createColumnHelper<DataTableFeatures, SamplePatient>()

export function usePatientColumns() {
  const { t } = useTranslation()

  return useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: ({ column }) => sortableHeader(column, t("patients.col.patient")),
          cell: ({ row }) => (
            <div className="flex flex-col">
              <Link to={`/patients/${row.original.ref ?? row.original.id}`} className="font-medium hover:underline">
                {row.original.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {t("patients.ageSex", { age: row.original.age, sex: t(`patients.sex.${row.original.sex}`) })}
              </span>
            </div>
          ),
        }),
        columnHelper.accessor("id", {
          header: t("patients.col.id"),
          cell: ({ row }) =>
            row.original.unsaved ? (
              <Badge variant="outline" className="border-caution/40 bg-caution-soft text-caution">
                {t("patients.notSaved")}
              </Badge>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>
            ),
        }),
        columnHelper.accessor("phone", {
          header: t("patients.col.phone"),
          cell: ({ row }) => (
            <Tooltip>
              <TooltipTrigger render={<span className="text-muted-foreground tabular-nums" />}>
                {row.original.phone}
              </TooltipTrigger>
              <TooltipContent>{t("patients.phoneMasked")}</TooltipContent>
            </Tooltip>
          ),
        }),
        columnHelper.accessor("language", {
          header: t("patients.col.language"),
          cell: ({ row }) => <LanguageCell code={row.original.language} />,
        }),
        columnHelper.accessor((p) => daysSince(p.lastVisit), {
          id: "lastVisit",
          header: ({ column }) => sortableHeader(column, t("patients.col.lastVisit")),
          cell: ({ getValue }) => {
            const d = getValue()
            return (
              <span className="text-muted-foreground">
                {d <= 0 ? t("patients.today") : d === 1 ? t("patients.yesterday") : t("patients.daysAgo", { count: d })}
              </span>
            )
          },
        }),
        columnHelper.accessor("visits", {
          header: ({ column }) => sortableHeader(column, t("patients.col.visits")),
          cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
        }),
        columnHelper.accessor("status", {
          header: t("patients.col.status"),
          cell: ({ getValue }) => {
            const s = getValue()
            const b = PATIENT_STATUS_BADGE[s]
            return (
              <Badge variant={b.variant} className={b.className}>
                {t(`patients.status.${s}`)}
              </Badge>
            )
          },
        }),
        columnHelper.display({
          id: "actions",
          cell: ({ row }) => (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    nativeButton={false}
                    render={<Link to={`/patients/${row.original.ref ?? row.original.id}`} />}
                  />
                }
              >
                <Eye />
                <span className="sr-only">{t("patients.open")}</span>
              </TooltipTrigger>
              <TooltipContent>{t("patients.open")}</TooltipContent>
            </Tooltip>
          ),
        }),
      ]),
    [t],
  )
}

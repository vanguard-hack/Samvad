import { createColumnHelper, type Column, type RowData } from "@tanstack/react-table"
import { ArrowUpDown, Eye, MoreHorizontal, Pencil } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { type DataTableFeatures } from "@/components/data-table/data-table-features"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { patientCode, QUEUE_STATUSES, type PatientRow, type QueuePatch } from "./patients-api"
import { byDue, byLastEvent, clockLabel, eventWhen, PRIORITY_OPTIONS, PRIORITY_STYLE, shortDuration, STATUS_STYLE } from "./queue-meta"

/** Sortable header, as in the shadcn data-table guide. */
function sortableHeader<TData extends RowData, TValue>(column: Column<DataTableFeatures, TData, TValue>, title: string) {
  return (
    <Button variant="ghost" size="sm" className="-ms-2.5 uppercase" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {title}
      <ArrowUpDown />
    </Button>
  )
}

const columnHelper = createColumnHelper<DataTableFeatures, PatientRow>()

type Actions = {
  onUpdate: (row: PatientRow, patch: QueuePatch) => void
  onEdit: (row: PatientRow) => void
}

export function useQueueColumns({ onUpdate, onEdit }: Actions) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("full_name", {
          header: t("queue.col.patient"),
          cell: ({ row }) => {
            const p = row.original
            return (
              <div className="flex flex-col leading-tight">
                <Link to={`/patients/${p.id}`} className="font-semibold hover:underline">
                  {p.full_name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {p.age} · {p.consent === "declined" ? t("patients.notSaved") : patientCode(p.patient_number)}
                </span>
                <span className="text-xs text-muted-foreground">{p.clinic ?? t("queue.noClinic")}</span>
              </div>
            )
          },
        }),
        columnHelper.accessor("reason", {
          header: t("queue.col.reason"),
          cell: ({ row }) => {
            const p = row.original
            return (
              <div className="flex flex-col items-start gap-1">
                <span className={cn("text-sm", !p.reason && "text-muted-foreground")}>{p.reason ?? t("queue.noReason")}</span>
                <Badge variant="outline" className={PRIORITY_STYLE[p.priority ?? "none"]}>
                  {t(`queue.priority.${p.priority ?? "none"}`)}
                </Badge>
              </div>
            )
          },
        }),
        columnHelper.accessor("last_event_at", {
          header: ({ column }) => sortableHeader(column, t("queue.col.lastEvent")),
          sortFn: (a, b) => -byLastEvent(a.original, b.original),
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {t(`queue.event.${row.original.last_event}`)} · {eventWhen(row.original.last_event_at, lang)}
            </span>
          ),
        }),
        columnHelper.accessor("due_at", {
          header: ({ column }) => sortableHeader(column, t("queue.col.due")),
          sortFn: (a, b) => byDue(a.original, b.original),
          cell: ({ row }) => {
            const due = row.original.due_at
            if (!due) return <span className="text-sm text-muted-foreground">{t("queue.noDue")}</span>
            const ms = +new Date(due) - Date.now()
            const done = row.original.queue_status === "completed"
            const overdue = ms < 0 && !done
            return (
              <div className={cn("flex flex-col text-sm leading-tight", overdue && "text-danger")}>
                <span className="font-medium tabular-nums">{clockLabel(due, lang)}</span>
                {!done && (
                  <span className={cn("text-xs", !overdue && "text-muted-foreground")}>
                    {overdue
                      ? t("queue.overdue", { duration: shortDuration(ms, lang) })
                      : t("queue.dueIn", { duration: shortDuration(ms, lang) })}
                  </span>
                )}
              </div>
            )
          },
        }),
        columnHelper.accessor("queue_status", {
          header: t("queue.col.status"),
          cell: ({ getValue }) => (
            <Badge variant="outline" className={STATUS_STYLE[getValue()]}>
              {t(`queue.status.${getValue()}`)}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: "actions",
          cell: ({ row }) => {
            const p = row.original
            return (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("queue.actions", { name: p.full_name })} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem render={<Link to={`/patients/${p.id}`} />}>
                      <Eye />
                      {t("patients.open")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(p)}>
                      <Pencil />
                      {t("queue.editDetails")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{t("queue.col.status")}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup value={p.queue_status} onValueChange={(v) => onUpdate(p, { queue_status: v as PatientRow["queue_status"] })}>
                        {QUEUE_STATUSES.map((s) => (
                          <DropdownMenuRadioItem key={s} value={s}>
                            {t(`queue.status.${s}`)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{t("queue.priorityLabel")}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={p.priority ?? "none"}
                        onValueChange={(v) => onUpdate(p, { priority: v === "none" ? null : (v as PatientRow["priority"]) })}
                      >
                        {PRIORITY_OPTIONS.map((o) => (
                          <DropdownMenuRadioItem key={o} value={o}>
                            {t(`queue.priority.${o}`)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          },
        }),
      ]),
    [t, lang, onUpdate, onEdit],
  )
}

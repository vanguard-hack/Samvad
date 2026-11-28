import { ArrowDownWideNarrow, ChevronDown, Loader2, Plus, Search, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "@/components/data-table/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useQueueColumns } from "@/features/patients/columns"
import { NewPatientDialog, type NewPatientInput } from "@/features/patients/new-patient-dialog"
import {
  createPatient,
  eventFor,
  listPatients,
  markSavedByAssistant,
  patientCode,
  QUEUE_STATUSES,
  saveIntakeRecording,
  updatePatientQueue,
  type PatientRow,
  type QueuePatch,
  type QueueStatus,
} from "@/features/patients/patients-api"
import { onPageAction } from "@/features/assistant/assistant-bus"
import { QueueDetailsDialog } from "@/features/patients/queue-details-dialog"
import { byDue, byLastEvent, byUrgency, PRIORITY_OPTIONS } from "@/features/patients/queue-meta"
import { addSessionPatient, isSessionPatient, listSessionPatients, updateSessionPatient } from "@/features/patients/session-patients"
import { cn } from "@/lib/utils"

const SORTS = { urgency: byUrgency, due: byDue, lastEvent: byLastEvent, name: (a: PatientRow, b: PatientRow) => a.full_name.localeCompare(b.full_name) }
type SortKey = keyof typeof SORTS

/** Patients saved in Supabase plus this tab's unsaved (consent declined) ones. */
const withSession = (saved: PatientRow[]) => [...listSessionPatients(), ...saved]

/**
 * Prioritized patient work queue: status tabs, search, priority / clinic
 * filters and urgency ordering. Everything shown is stored in Supabase.
 */
export function PatientsPage() {
  const { t } = useTranslation()
  const [patients, setPatients] = useState<PatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [updateError, setUpdateError] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PatientRow | null>(null)
  // Language for a registration the voice assistant started (auto voice + auto save).
  const [autoLanguage, setAutoLanguage] = useState<string | null>(null)

  const [tab, setTab] = useState<QueueStatus>("needs_action")
  const [query, setQuery] = useState("")
  const [priority, setPriority] = useState("all")
  const [clinic, setClinic] = useState("all")
  const [sort, setSort] = useState<SortKey>("urgency")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setPatients(withSession(await listPatients()))
    } catch {
      setLoadError(true)
      setPatients(withSession([]))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Actions from the Ctrl+Space voice assistant.
  useEffect(
    () =>
      onPageAction((action) => {
        if (action.type === "refresh") void load()
        else if (action.type === "start_registration") {
          setAutoLanguage(action.language)
          setAdding(true)
        } else if (action.type === "show_queue") {
          if (action.status && (QUEUE_STATUSES as readonly string[]).includes(action.status)) setTab(action.status as QueueStatus)
          if (action.priority) setPriority(action.priority)
          if (action.clinic) setClinic(action.clinic === "all" ? "all" : action.clinic)
          if (action.search !== undefined) setQuery(action.search)
        }
      }),
    [load],
  )

  const replace = (row: PatientRow) => setPatients((list) => list.map((p) => (p.id === row.id ? row : p)))

  /** Saves a queue edit (status, priority, details). Unsaved patients change in memory only. */
  const save = useCallback(async (p: PatientRow, patch: QueuePatch) => {
    setUpdateError(false)
    if (isSessionPatient(p.id)) {
      const row = updateSessionPatient(p.id, { ...patch, last_event: eventFor(patch), last_event_at: new Date().toISOString() })
      if (row) replace(row)
      return
    }
    replace({ ...p, ...patch }) // optimistic
    try {
      replace(await updatePatientQueue(p.id, patch))
    } catch (err) {
      replace(p)
      setUpdateError(true)
      throw err
    }
  }, [])

  const columns = useQueueColumns({
    onUpdate: useCallback((p: PatientRow, patch: QueuePatch) => void save(p, patch).catch(() => {}), [save]),
    onEdit: setEditing,
  })

  /** Consent given → saved to Supabase. Declined → memory only, never stored (Critical Rule 3). */
  const onCreate = async ({ consent, recording, byAssistant, ...p }: NewPatientInput): Promise<string | null> => {
    if (consent === "given") {
      const row = await createPatient(p)
      try {
        await saveIntakeRecording(row, recording) // the patient is kept even if audio upload fails
        if (byAssistant) await markSavedByAssistant(row)
      } catch {
        /* recording / audit mark optional */
      }
      setPatients((list) => [row, ...list])
      setTab("needs_action")
      return patientCode(row.patient_number)
    }
    const now = new Date().toISOString()
    const row = addSessionPatient({
      ...p,
      clinic: null,
      reason: null,
      priority: null,
      queue_status: "needs_action",
      last_event: "registered",
      last_event_at: now,
      due_at: null,
      visits: 0,
      last_visit: now.slice(0, 10),
      created_at: now,
    })
    setPatients((list) => [row, ...list])
    setTab("needs_action")
    return null
  }

  const counts = useMemo(() => {
    const c = Object.fromEntries(QUEUE_STATUSES.map((s) => [s, 0])) as Record<QueueStatus, number>
    for (const p of patients) c[p.queue_status]++
    return c
  }, [patients])

  const clinics = useMemo(() => [...new Set(patients.map((p) => p.clinic).filter((c): c is string => !!c))].sort(), [patients])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return patients
      .filter((p) => p.queue_status === tab)
      .filter((p) => priority === "all" || (p.priority ?? "none") === priority)
      .filter((p) => clinic === "all" || p.clinic === clinic)
      .filter(
        (p) =>
          !q ||
          [p.full_name, patientCode(p.patient_number), p.reason ?? "", p.clinic ?? ""].some((v) => v.toLowerCase().includes(q)),
      )
      .sort(SORTS[sort])
  }, [patients, tab, priority, clinic, query, sort])

  const filtered = priority !== "all" || clinic !== "all" || query !== ""

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            {t("queue.title")}
            <Badge className="h-4.5 bg-danger px-1.5 text-[11px] text-white tabular-nums">
              {loading ? <Loader2 className="animate-spin" /> : counts.needs_action}
            </Badge>
          </h1>
          <p className="text-xs text-muted-foreground">{t("queue.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t("queue.col.status")} className="flex rounded-lg border bg-muted/50 p-0.5">
            {QUEUE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  tab === s ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`queue.status.${s}`)} · <span className="tabular-nums">{counts[s]}</span>
              </button>
            ))}
          </div>
          <Button size="xs" onClick={() => setAdding(true)}>
            <Plus />
            {t("patients.add")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("queue.search")}
            aria-label={t("queue.search")}
            className="h-7 ps-8 text-xs"
          />
        </div>
        <FilterPill
          label={t("queue.priorityLabel")}
          value={priority}
          onChange={setPriority}
          options={[["all", t("queue.all")], ...PRIORITY_OPTIONS.map((o) => [o, t(`queue.priority.${o}`)] as [string, string])]}
        />
        <FilterPill
          label={t("queue.clinic")}
          value={clinic}
          onChange={setClinic}
          options={[["all", t("queue.all")], ...clinics.map((c) => [c, c] as [string, string])]}
        />
        <FilterPill
          icon={<ArrowDownWideNarrow />}
          label={t("queue.sortBy")}
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={(Object.keys(SORTS) as SortKey[]).map((k) => [k, t(`queue.sort.${k}`)])}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setQuery("")
              setPriority("all")
              setClinic("all")
            }}
          >
            <X />
            {t("queue.clear")}
          </Button>
        )}
      </div>

      {(loadError || updateError) && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {loadError ? t("patients.loadError") : t("queue.updateError")}
          {loadError && (
            <Button variant="outline" size="xs" onClick={() => void load()}>
              {t("patients.retry")}
            </Button>
          )}
        </p>
      )}

      {/* Compact queue table: small text, uppercase muted headers. */}
      <div className="flex min-h-0 flex-1 flex-col [&_table]:text-xs [&_th]:h-8 [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase">
        <DataTable columns={columns} data={rows} pageSize="auto" />
      </div>

      <NewPatientDialog
        key={autoLanguage ?? "manual"}
        open={adding}
        onOpenChange={(o) => {
          setAdding(o)
          if (!o) setAutoLanguage(null)
        }}
        onCreate={onCreate}
        autoLanguage={autoLanguage}
      />
      <QueueDetailsDialog patient={editing} clinics={clinics} onOpenChange={(o) => !o && setEditing(null)} onSave={save} />
    </div>
  )
}

/** "Label | Value ▾" filter button with a radio menu. */
function FilterPill({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  icon?: ReactNode
}) {
  const current = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" className="gap-1 text-xs" />}>
        {icon}
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium">{current}</span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map(([v, text]) => (
            <DropdownMenuRadioItem key={v} value={v}>
              {text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

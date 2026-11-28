import { Loader2, Plus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "@/components/data-table/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type SamplePatient } from "@/data/sample"
import { usePatientColumns } from "@/features/patients/columns"
import { NewPatientDialog, type NewPatientInput } from "@/features/patients/new-patient-dialog"
import { createPatient, listPatients, patientCode, saveIntakeRecording, toTableRow } from "@/features/patients/patients-api"
import { addSessionPatient, listSessionPatients } from "@/features/patients/session-patients"

/** Patients saved in Supabase, plus this tab's unsaved (consent declined) ones on top. */
function withSession(saved: SamplePatient[]) {
  const session = listSessionPatients().map((p) => ({ ...toTableRow(p), id: "—", unsaved: true }))
  return [...session, ...saved]
}

export function PatientsPage() {
  const { t } = useTranslation()
  const columns = usePatientColumns()
  const [patients, setPatients] = useState<SamplePatient[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setPatients(withSession((await listPatients()).map(toTableRow)))
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

  /** Consent given → saved to Supabase. Declined → memory only, never stored (Critical Rule 3). */
  const onCreate = async ({ consent, recording, ...p }: NewPatientInput): Promise<string | null> => {
    if (consent === "given") {
      const row = await createPatient(p)
      // The patient is saved even if some audio fails to upload; their text answers are kept.
      try {
        await saveIntakeRecording(row, recording)
      } catch {
        /* recording optional */
      }
      setPatients((list) => [toTableRow(row), ...list])
      return patientCode(row.patient_number)
    }
    const row = addSessionPatient({
      ...p,
      status: "active",
      visits: 0,
      last_visit: new Date().toLocaleDateString("en-CA"),
      created_at: new Date().toISOString(),
    })
    setPatients((list) => [{ ...toTableRow(row), id: "—", unsaved: true }, ...list])
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {t("patients.title")}
            <Badge variant="secondary">{loading ? <Loader2 className="animate-spin" /> : patients.length}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{t("patients.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            {t("patients.add")}
          </Button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {t("patients.loadError")}
          <Button variant="outline" size="xs" onClick={() => void load()}>
            {t("patients.retry")}
          </Button>
        </p>
      )}

      <DataTable
        columns={columns}
        data={patients}
        filterColumn="name"
        filterPlaceholder={t("patients.searchPlaceholder")}
        pageSize="auto"
      />

      <NewPatientDialog open={adding} onOpenChange={setAdding} onCreate={onCreate} />
    </div>
  )
}

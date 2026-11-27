import { Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "@/components/data-table/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SAMPLE_PATIENTS, type SamplePatient } from "@/data/sample"
import { usePatientColumns } from "@/features/patients/columns"
import { NewPatientDialog } from "@/features/patients/new-patient-dialog"

/** Next free SMV-#### id. */
function nextPatientId(list: SamplePatient[]) {
  const max = Math.max(1000, ...list.map((p) => Number(p.id.replace(/\D/g, "")) || 0))
  return `SMV-${max + 1}`
}

export function PatientsPage() {
  const { t } = useTranslation()
  const columns = usePatientColumns()
  // Sample data held in memory only: new patients vanish on reload (no backend yet).
  const [patients, setPatients] = useState(SAMPLE_PATIENTS)
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {t("patients.title")}
            <Badge variant="secondary">{patients.length}</Badge>
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

      <DataTable
        columns={columns}
        data={patients}
        filterColumn="name"
        filterPlaceholder={t("patients.searchPlaceholder")}
        pageSize="auto"
      />

      <NewPatientDialog
        open={adding}
        onOpenChange={setAdding}
        nextId={nextPatientId(patients)}
        onCreate={(p) => setPatients((list) => [p, ...list])}
      />
    </div>
  )
}

import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { DataTable } from "@/components/data-table/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SAMPLE_PATIENTS } from "@/data/sample"
import { CONSULTATION_STEPS } from "@/features/consultation/steps"
import { usePatientColumns } from "@/features/patients/columns"

export function PatientsPage() {
  const { t } = useTranslation()
  const columns = usePatientColumns()

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {t("patients.title")}
            <Badge variant="secondary">{SAMPLE_PATIENTS.length}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{t("patients.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link to={CONSULTATION_STEPS[0].path} />}>
            <Plus />
            {t("patients.add")}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={SAMPLE_PATIENTS}
        filterColumn="name"
        filterPlaceholder={t("patients.searchPlaceholder")}
        pageSize="auto"
      />
    </div>
  )
}

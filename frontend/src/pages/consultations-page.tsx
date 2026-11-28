import { X } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "@/components/data-table/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SAMPLE_APPOINTMENTS, type AppointmentStatus, type SampleAppointment } from "@/data/appointments"
import { AppointmentDialog } from "@/features/consultations/appointment-dialog"
import { useAppointmentColumns } from "@/features/consultations/columns"

const PAGE_SIZE = 10

export function ConsultationsPage() {
  const { t } = useTranslation()
  // Sample data held in memory only: status changes vanish on reload (no backend yet).
  const [appointments, setAppointments] = useState(SAMPLE_APPOINTMENTS)
  const [openId, setOpenId] = useState<string | null>(null)
  // ISO date (yyyy-mm-dd) from the date input; "" shows every date.
  const [date, setDate] = useState("")

  const onOpen = useCallback((a: SampleAppointment) => setOpenId(a.id), [])
  const columns = useAppointmentColumns(onOpen)
  const visible = useMemo(() => (date ? appointments.filter((a) => a.date === date) : appointments), [appointments, date])
  // Looked up by id so the dialog shows the latest status after a change.
  const open = appointments.find((a) => a.id === openId) ?? null

  const setStatus = (id: string, status: AppointmentStatus) =>
    setAppointments((list) => list.map((a) => (a.id === id ? { ...a, status } : a)))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t("consultations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("consultations.subtitle")}</p>
      </div>

      <DataTable
        columns={columns}
        data={visible}
        filterColumn="id"
        filterPlaceholder={t("consultations.searchPlaceholder")}
        pageSize={PAGE_SIZE}
        autoResetPageIndex={false}
        toolbar={
          <div className="flex items-center gap-1">
            <Input
              type="date"
              aria-label={t("consultations.filterByDate")}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
            />
            {date && (
              <Button variant="ghost" size="icon-sm" onClick={() => setDate("")}>
                <X />
                <span className="sr-only">{t("consultations.clearDate")}</span>
              </Button>
            )}
          </div>
        }
      />

      <AppointmentDialog
        appointment={open}
        onOpenChange={(next) => !next && setOpenId(null)}
        onStatusChange={setStatus}
      />
    </div>
  )
}

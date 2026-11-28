import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { type AppointmentStatus } from "@/data/appointments"

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

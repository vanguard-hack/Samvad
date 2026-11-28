import { type PatientStatus } from "@/data/sample"

/** Badge styling by meaning for sample patients: caution = needs a human check (safety). */
export const PATIENT_STATUS_BADGE: Record<PatientStatus, { variant: "secondary" | "default" | "outline"; className?: string }> = {
  active: { variant: "secondary" },
  followUp: { variant: "outline", className: "border-primary/40 text-primary" },
  needsReview: { variant: "outline", className: "border-caution/40 bg-caution-soft text-caution" },
}

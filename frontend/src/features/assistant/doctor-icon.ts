import { createLucideIcon } from "lucide-react"

/**
 * A doctor in a lab coat: head, open coat with lapels and button line, and a
 * pen in the breast pocket. Lucide has no such icon, so it is drawn on Lucide's
 * 24px grid with its stroke rules and behaves like any other `LucideIcon`
 * (size, strokeWidth, className) in the sidebar and elsewhere.
 */
export const DoctorIcon = createLucideIcon("doctor-lab-coat", [
  ["circle", { cx: "12", cy: "6.5", r: "3.5", key: "head" }],
  ["path", { d: "M4 21v-1.5a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6V21", key: "coat" }],
  ["path", { d: "m9.5 13.5 2.5 5 2.5-5", key: "lapels" }],
  ["path", { d: "M12 18.5V21", key: "placket" }],
  ["path", { d: "M16.5 17v2", key: "pocket-pen" }],
])

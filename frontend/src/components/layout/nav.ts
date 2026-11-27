import {
  AudioLinesIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HeadsetIcon,
  MessagesSquareIcon,
  PillIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"
import { PENDING_APPROVAL_COUNT } from "@/data/sample"
import { CONSULTATION_STEPS } from "@/features/consultation/steps"

export interface NavItem {
  key: string // nav.<key> i18n label
  to: string
  icon: LucideIcon
  badge?: number
  /** Build phase that delivers this screen (for placeholders). */
  phase?: number
}

export interface NavGroup {
  key: string // nav.groups.<key>
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { key: "patients", to: "/", icon: UsersIcon },
      { key: "interpreter", to: "/interpreter", icon: AudioLinesIcon },
      { key: "consultations", to: "/consultations", icon: MessagesSquareIcon, phase: 2 },
    ],
  },
  {
    key: "clinical",
    items: [
      { key: "approvals", to: "/approvals", icon: ClipboardCheckIcon, badge: PENDING_APPROVAL_COUNT, phase: 3 },
      { key: "prescriptions", to: "/prescriptions", icon: PillIcon, phase: 3 },
      { key: "reports", to: "/reports", icon: FileTextIcon, phase: 3 },
    ],
  },
]

export const NAV_FOOTER: NavItem[] = [{ key: "help", to: "/help", icon: HeadsetIcon, phase: 6 }]

/** Reached from the account menu only, not the sidebar. */
export const ACCOUNT_ITEMS: NavItem[] = [
  { key: "profile", to: "/profile", icon: UserRoundIcon },
  { key: "settings", to: "/settings", icon: SettingsIcon, phase: 6 },
]

export const ALL_NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER, ...ACCOUNT_ITEMS]

export function isActivePath(pathname: string, to: string) {
  // "/" is the Patients home; a patient record (/patients/:id) belongs to it too.
  if (to === "/") return pathname === "/" || pathname.startsWith("/patients/")
  return pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * Breadcrumb trail for a path, as i18n keys or literal strings:
 * e.g. /approvals → ["nav.groups.clinical", "nav.approvals"].
 */
export function breadcrumbFor(pathname: string): { label: string; literal?: boolean; to?: string }[] {
  const step = CONSULTATION_STEPS.find((s) => s.path === pathname)
  if (step) return [{ label: "nav.groups.workspace" }, { label: "nav.consultations", to: "/consultations" }, { label: `steps.${step.id}.title` }]

  const patient = pathname.match(/^\/patients\/(.+)$/)
  if (patient) return [{ label: "nav.groups.workspace" }, { label: "nav.patients", to: "/" }, { label: patient[1], literal: true }]

  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => isActivePath(pathname, i.to))
    if (item) return [{ label: `nav.groups.${group.key}` }, { label: `nav.${item.key}` }]
  }
  const footer = [...NAV_FOOTER, ...ACCOUNT_ITEMS].find((i) => isActivePath(pathname, i.to))
  return footer ? [{ label: `nav.${footer.key}` }] : []
}

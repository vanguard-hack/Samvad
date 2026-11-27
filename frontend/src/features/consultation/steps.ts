import {
  ClipboardListIcon,
  FileSignatureIcon,
  LanguagesIcon,
  MessagesSquareIcon,
  PillIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'

export type StepId = 'language' | 'consent' | 'live' | 'intake' | 'review' | 'closing'

export interface ConsultationStep {
  id: StepId
  number: number
  icon: LucideIcon
  /** Build phase that delivers this screen. */
  phase: number
  path: string
}

export const CONSULTATION_STEPS: ConsultationStep[] = [
  { id: 'language', number: 1, icon: LanguagesIcon, phase: 2, path: '/consult/language' },
  { id: 'consent', number: 2, icon: ShieldCheckIcon, phase: 2, path: '/consult/consent' },
  { id: 'live', number: 3, icon: MessagesSquareIcon, phase: 2, path: '/consult/live' },
  { id: 'intake', number: 4, icon: ClipboardListIcon, phase: 3, path: '/consult/intake' },
  { id: 'review', number: 5, icon: FileSignatureIcon, phase: 3, path: '/consult/review' },
  { id: 'closing', number: 6, icon: PillIcon, phase: 4, path: '/consult/closing' },
]

export function getStep(id: string | undefined) {
  return CONSULTATION_STEPS.find((s) => s.id === id)
}

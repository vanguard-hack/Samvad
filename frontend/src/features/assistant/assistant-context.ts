import { createContext, useContext } from "react"

import type { ScheduleData } from "@/features/assistant/types"

export interface AssistantContextValue {
  /** The live schedule, so answer cards show the latest status. */
  data: ScheduleData
  openAppointment: (id: string) => void
  /** Asks a follow-up from inside an answer (a legend item, a chip). */
  ask: (label: string, query: string) => void
  pending: boolean
}

export const AssistantContext = createContext<AssistantContextValue | null>(null)

export function useAssistant() {
  const value = useContext(AssistantContext)
  if (!value) throw new Error("useAssistant must be used inside <AssistantContext.Provider>")
  return value
}

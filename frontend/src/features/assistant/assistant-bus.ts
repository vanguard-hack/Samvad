/**
 * Hands actions from the voice assistant to whichever page should carry them
 * out. An action that arrives before its page has mounted (e.g. right after a
 * navigation) is kept as "pending" and picked up when the page subscribes.
 */
export type AssistantAction =
  | { type: "navigate"; page: "patients" | "interpreter" | "profile" | "patient"; patient_id?: string }
  | { type: "show_queue"; status?: string; priority?: string; clinic?: string; search?: string }
  | { type: "start_registration"; language: string }
  | { type: "refresh" }

type PageAction = Exclude<AssistantAction, { type: "navigate" }>
type Listener = (action: PageAction) => void

let pending: PageAction[] = []
const listeners = new Set<Listener>()

export function emitPageAction(action: PageAction) {
  if (listeners.size === 0) {
    pending.push(action)
    return
  }
  listeners.forEach((l) => l(action))
}

/** Subscribe (the patients page does); returns the unsubscribe function. */
export function onPageAction(listener: Listener): () => void {
  listeners.add(listener)
  const queued = pending
  pending = []
  queued.forEach((a) => listener(a))
  return () => listeners.delete(listener)
}

/**
 * A screen can take over Ctrl+Space while it is open (the New patient form
 * uses it to start its voice questions). The latest claim wins.
 */
let shortcutOwner: (() => void) | null = null

export function claimShortcut(handler: () => void): () => void {
  shortcutOwner = handler
  return () => {
    if (shortcutOwner === handler) shortcutOwner = null
  }
}

/** Runs the claimed handler, if any; returns whether one ran. */
export function runClaimedShortcut(): boolean {
  if (!shortcutOwner) return false
  shortcutOwner()
  return true
}

import type { User } from "@supabase/supabase-js"

/**
 * The doctor's name for display. Sign-up stores first_name/last_name; Google
 * fills full_name/name (and sometimes given_name/family_name). Falls back to the
 * email's local part only when no name is known.
 */
export function displayName(user: User | null | undefined): string {
  const m = (user?.user_metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const first = str(m.first_name) || str(m.given_name)
  const last = str(m.last_name) || str(m.family_name)
  return (
    [first, last].filter(Boolean).join(" ") ||
    str(m.full_name) ||
    str(m.name) ||
    (user?.email ?? "").split("@")[0] ||
    "—"
  )
}

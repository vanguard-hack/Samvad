import { Check, Loader2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { errorKey } from "@/auth/auth-errors"
import { useAuth } from "@/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

/** The stored full name, or first + last (Google sometimes only sends those). */
function initialName(meta: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  return (
    str(meta.full_name) ||
    [str(meta.first_name) || str(meta.given_name), str(meta.last_name) || str(meta.family_name)].filter(Boolean).join(" ") ||
    str(meta.name)
  )
}

/** The doctor's first and last name, shown in the account menu. */
export function ProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const start = initialName((user?.user_metadata ?? {}) as Record<string, unknown>)
  const [name, setName] = useState(start)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clean = name.trim().replace(/\s+/g, " ")
  const changed = clean !== start
  const valid = clean !== ""

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    setSaved(false)
    // First/last are derived from the one box (split on the first space).
    const [first = "", ...rest] = clean.split(" ")
    // USER_UPDATED refreshes the session, so the account menu picks the new name up at once.
    const { error } = await supabase.auth.updateUser({ data: { full_name: clean, first_name: first, last_name: rest.join(" ") } })
    setBusy(false)
    if (error) return setError(t(errorKey(error)))
    setSaved(true)
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t("profile.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("profile.hint")}</p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 rounded-xl border bg-card p-5" noValidate>
        <label htmlFor="profile-name" className="text-sm font-medium">
          {t("auth.fullName")}
        </label>
        <Input
          id="profile-name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
          }}
        />

        <label htmlFor="profile-email" className="text-sm font-medium">
          {t("auth.email")}
        </label>
        <Input id="profile-email" type="email" value={user?.email ?? ""} readOnly disabled />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={busy || !valid || !changed}>
            {busy && <Loader2 className="animate-spin" />}
            {t("profile.save")}
          </Button>
          <p role="status" aria-live="polite" className="flex items-center gap-1 text-sm text-muted-foreground">
            {saved && (
              <>
                <Check className="size-4 text-primary" aria-hidden="true" />
                {t("profile.saved")}
              </>
            )}
          </p>
        </div>
      </form>
    </section>
  )
}

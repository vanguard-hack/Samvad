import { Check, Loader2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { errorKey } from "@/auth/auth-errors"
import { useAuth } from "@/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

/** Existing first/last name, or a split of Google's full name. */
function initialNames(meta: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const first = str(meta.first_name) || str(meta.given_name)
  const last = str(meta.last_name) || str(meta.family_name)
  if (first || last) return { first, last }
  const [head = "", ...rest] = (str(meta.full_name) || str(meta.name)).split(/\s+/)
  return { first: head, last: rest.join(" ") }
}

/** The doctor's first and last name, shown in the account menu. */
export function ProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const start = initialNames((user?.user_metadata ?? {}) as Record<string, unknown>)
  const [first, setFirst] = useState(start.first)
  const [last, setLast] = useState(start.last)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = first.trim() !== start.first || last.trim() !== start.last
  const valid = first.trim() !== "" && last.trim() !== ""

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    setSaved(false)
    const f = first.trim()
    const l = last.trim()
    // USER_UPDATED refreshes the session, so the account menu picks the new name up at once.
    const { error } = await supabase.auth.updateUser({ data: { first_name: f, last_name: l, full_name: `${f} ${l}` } })
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
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="profile-first" className="text-sm font-medium">
              {t("auth.firstName")}
            </label>
            <Input
              id="profile-first"
              autoComplete="given-name"
              required
              value={first}
              onChange={(e) => {
                setFirst(e.target.value)
                setSaved(false)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="profile-last" className="text-sm font-medium">
              {t("auth.lastName")}
            </label>
            <Input
              id="profile-last"
              autoComplete="family-name"
              required
              value={last}
              onChange={(e) => {
                setLast(e.target.value)
                setSaved(false)
              }}
            />
          </div>
        </div>

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

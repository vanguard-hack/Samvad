import { Loader2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"

import { errorKey, MIN_PASSWORD, RECOVERY_FLAG } from "@/auth/auth-errors"
import { useAuth } from "@/auth/auth-provider"
import { LogoMark } from "@/components/brand/logo"
import { FullPageLoader } from "@/components/full-page-loader"
import { PasswordStrengthInput } from "@/components/reui/password-strength-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

/**
 * Choose a new password. Reached from the reset email (Supabase signs the user in
 * from the link) or from the account menu, which lets code/Google accounts add one.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, isLoaded } = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => sessionStorage.removeItem(RECOVERY_FLAG), [])

  if (!isLoaded) return <FullPageLoader />

  const mismatch = confirm.length > 0 && confirm !== password
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(t(errorKey(error)))
    navigate("/", { replace: true })
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-6">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-none sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-9" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{t("auth.newPasswordTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {session ? t("auth.passwordRule", { n: MIN_PASSWORD }) : t("auth.resetExpired")}
            </p>
          </div>
        </div>

        {session ? (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3" noValidate>
            {/* Lets password managers save the new password against the right account. */}
            <input type="email" autoComplete="username" value={session.user.email ?? ""} readOnly hidden />
            <label htmlFor="new-password" className="text-sm font-medium">
              {t("auth.newPassword")}
            </label>
            <PasswordStrengthInput
              id="new-password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              autoFocus
              value={password}
              onValueChange={setPassword}
            />
            <label htmlFor="confirm-password" className="text-sm font-medium">
              {t("auth.confirmPassword")}
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch || undefined}
            />
            {(mismatch || error) && (
              <p role="alert" className="text-sm text-destructive">
                {mismatch ? t("auth.errors.mismatch") : error}
              </p>
            )}
            <Button type="submit" disabled={busy || password.length < MIN_PASSWORD || confirm !== password}>
              {busy && <Loader2 className="animate-spin" />}
              {t("auth.savePassword")}
            </Button>
          </form>
        ) : (
          <Button className="w-full" nativeButton={false} render={<Link to="/sign-in" />}>
            {t("auth.backToSignIn")}
          </Button>
        )}
      </div>
    </main>
  )
}

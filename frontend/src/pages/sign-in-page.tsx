import { ArrowLeft, Loader2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

/** Supabase rate-limits OTP emails to one per 60 s per address by default. */
const RESEND_SECONDS = 60

type Step = "email" | "code"

function errorKey(error: { status?: number; code?: string; message?: string }) {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") return "auth.errors.rateLimit"
  if (error.code === "otp_expired" || /expired|invalid/i.test(error.message ?? "")) return "auth.errors.badCode"
  if (error.code === "signup_disabled") return "auth.errors.signupDisabled"
  return "auth.errors.generic"
}

/** Doctor sign-in: email → 6-digit code. Supabase creates the account on first sign-in. */
export function SignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? "/"

  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const sendCode = async () => {
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setError(t(errorKey(error)))
    setStep("code")
    setCode("")
    setCooldown(RESEND_SECONDS)
  }

  const verifyCode = async () => {
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" })
    setBusy(false)
    if (error) return setError(t(errorKey(error)))
    navigate(from, { replace: true })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void (step === "email" ? sendCode() : verifyCode())
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-6">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-none sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-9" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{t("auth.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {step === "email" ? t("auth.emailHint") : t("auth.codeHint", { email: email.trim() })}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {step === "email" ? (
            <>
              <label htmlFor="email" className="text-sm font-medium">
                {t("auth.email")}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@clinic.in"
              />
            </>
          ) : (
            <>
              <label htmlFor="code" className="text-sm font-medium">
                {t("auth.code")}
              </label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={10}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.4em]"
                aria-describedby={error ? "auth-error" : undefined}
              />
            </>
          )}

          {error && (
            <p id="auth-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy || (step === "email" ? !/^\S+@\S+\.\S+$/.test(email.trim()) : code.length < 6)}
          >
            {busy && <Loader2 className="animate-spin" />}
            {step === "email" ? t("auth.sendCode") : t("auth.verify")}
          </Button>

          {step === "code" && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("email")
                  setError(null)
                }}
              >
                <ArrowLeft className="rtl:rotate-180" />
                {t("auth.changeEmail")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy || cooldown > 0} onClick={() => void sendCode()}>
                {cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}
              </Button>
            </div>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">{t("auth.doctorsOnly")}</p>
      </div>
    </main>
  )
}

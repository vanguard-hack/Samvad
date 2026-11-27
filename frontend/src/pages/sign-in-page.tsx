import { ArrowLeft, Loader2, MailCheck } from "lucide-react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"
import { errorKey, MIN_PASSWORD, RECOVERY_FLAG, type AuthError } from "@/auth/auth-errors"
import { supabase } from "@/lib/supabase"

/** Supabase rate-limits OTP emails to one per 60 s per address by default. */
const RESEND_SECONDS = 60
/** Supabase email OTP length (Auth → Providers → Email → "Email OTP Length"). */
const CODE_LENGTH = 6

/**
 * signIn   email + password (default)      signUp  create an account with a password
 * otpEmail email → send a 6-digit code     otpCode enter that code
 * forgot   email → password reset link     sent    "check your email" after sign-up / reset
 */
type Mode = "signIn" | "signUp" | "otpEmail" | "otpCode" | "forgot" | "sent"

const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim())

/** Google's "G" mark, as its sign-in branding guidelines require on the button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  )
}

/** Doctor sign-in: Google, email + password, or a one-time email code. */
export function SignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? "/"

  const [mode, setMode] = useState<Mode>(location.pathname === "/sign-up" ? "signUp" : "signIn")
  const [sentKey, setSentKey] = useState("auth.confirmSent")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Supabase's own error text, shown small under the friendly message for support.
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  // Submit as soon as the last digit is in (after React has the full code).
  useEffect(() => {
    if (code.length === CODE_LENGTH) formRef.current?.requestSubmit()
  }, [code])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const go = (next: Mode) => {
    setMode(next)
    setError(null)
    setErrorDetail(null)
    setPassword("")
    setConfirm("")
  }

  /** Runs one Supabase call with the busy/error handling every form shares. */
  const run = async (call: () => Promise<{ error: AuthError | null }>, onOk: () => void) => {
    if (!supabase) return
    setBusy(true)
    setError(null)
    setErrorDetail(null)
    const { error } = await call()
    setBusy(false)
    if (error) {
      setError(t(errorKey(error)))
      setErrorDetail([error.code, error.message].filter(Boolean).join(": ") || null)
      return
    }
    onOk()
  }

  const google = () =>
    void run(
      // Leaves the page for Google; the session is picked up on return.
      () => supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + from } }),
      () => {},
    )

  const sendCode = () =>
    run(
      () =>
        supabase!.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
        }),
      () => {
        setMode("otpCode")
        setCode("")
        setCooldown(RESEND_SECONDS)
      },
    )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const addr = email.trim()
    if (mode === "signIn")
      void run(() => supabase!.auth.signInWithPassword({ email: addr, password }), () => navigate(from, { replace: true }))
    else if (mode === "signUp") {
      let signedIn = false
      void run(
        async () => {
          const first = firstName.trim()
          const last = lastName.trim()
          const res = await supabase!.auth.signUp({
            email: addr,
            password,
            options: {
              emailRedirectTo: window.location.origin,
              data: { first_name: first, last_name: last, full_name: `${first} ${last}`.trim() },
            },
          })
          signedIn = Boolean(res.data.session) // no session = "Confirm email" is on
          // Supabase hides existing accounts: it "succeeds" with no identities and sends no email.
          if (!res.error && res.data.user && res.data.user.identities?.length === 0)
            return { error: { code: "user_already_exists" } }
          return res
        },
        () => {
          if (signedIn) return navigate(from, { replace: true })
          setSentKey("auth.confirmSent")
          setMode("sent")
        },
      )
    } else if (mode === "forgot")
      void run(
        () => supabase!.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/reset-password` }),
        () => {
          setSentKey("auth.resetSent")
          setMode("sent")
        },
      )
    else if (mode === "otpEmail") void sendCode()
    else if (mode === "otpCode")
      void run(() => supabase!.auth.verifyOtp({ email: addr, token: code.trim(), type: "email" }), () => navigate(from, { replace: true }))
    else if (mode === "sent") {
      // The emailed code works like the link: signup confirms the account, recovery leads to a new password.
      const recovery = sentKey === "auth.resetSent"
      if (recovery) sessionStorage.setItem(RECOVERY_FLAG, "1") // RedirectIfSignedIn sends us to /reset-password
      void run(
        async () => {
          const res = await supabase!.auth.verifyOtp({ email: addr, token: code.trim(), type: recovery ? "recovery" : "signup" })
          if (res.error) sessionStorage.removeItem(RECOVERY_FLAG)
          return res
        },
        () => navigate(recovery ? "/reset-password" : from, { replace: true }),
      )
    }
  }

  const passwordMode = mode === "signIn" || mode === "signUp"
  const codeMode = mode === "otpCode" || mode === "sent"
  const canSubmit =
    !busy &&
    (codeMode
      ? code.length === CODE_LENGTH
      : isEmail(email) &&
        (!passwordMode || password.length >= (mode === "signUp" ? MIN_PASSWORD : 1)) &&
        (mode !== "signUp" || (firstName.trim() !== "" && lastName.trim() !== "" && confirm === password)))

  const hint = {
    signIn: t("auth.signInHint"),
    signUp: t("auth.signUpHint"),
    otpEmail: t("auth.emailHint"),
    otpCode: t("auth.codeHint", { email: email.trim() }),
    forgot: t("auth.forgotHint"),
    sent: t(sentKey, { email: email.trim() }),
  }[mode]

  const back = (
    <Button type="button" variant="ghost" size="sm" className="self-center" onClick={() => go("signIn")}>
      <ArrowLeft className="rtl:rotate-180" />
      {t("auth.backToSignIn")}
    </Button>
  )

  // ── Create account: after shadcn's signup-01 block (Card + Field) ──────────
  if (mode === "signUp") {
    const mismatch = confirm.length > 0 && confirm !== password
    return (
      <main className="flex min-h-dvh w-full items-center justify-center bg-background p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <LogoMark className="mx-auto mb-2 size-9" />
              <CardTitle className="text-lg">{t("auth.signUpTitle")}</CardTitle>
              <CardDescription>{t("auth.signUpHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form ref={formRef} onSubmit={onSubmit} noValidate>
                <FieldGroup>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="first-name">{t("auth.firstName")}</FieldLabel>
                      <Input
                        id="first-name"
                        autoComplete="given-name"
                        required
                        autoFocus
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="last-name">{t("auth.lastName")}</FieldLabel>
                      <Input
                        id="last-name"
                        autoComplete="family-name"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      inputMode="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="doctor@clinic.in"
                    />
                    <FieldDescription>{t("auth.emailUse")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <FieldDescription>{t("auth.passwordRule", { n: MIN_PASSWORD })}</FieldDescription>
                  </Field>
                  <Field data-invalid={mismatch || undefined}>
                    <FieldLabel htmlFor="confirm-password">{t("auth.confirmPassword")}</FieldLabel>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={mismatch || undefined}
                    />
                    <FieldDescription>{mismatch ? t("auth.errors.mismatch") : t("auth.confirmHint")}</FieldDescription>
                  </Field>

                  {error && (
                    <div id="auth-error" role="alert" className="flex flex-col gap-1">
                      <p className="text-sm text-destructive">{error}</p>
                      {errorDetail && <p className="font-mono text-xs break-words text-muted-foreground">{errorDetail}</p>}
                    </div>
                  )}

                  <Field>
                    <Button type="submit" disabled={!canSubmit}>
                      {busy && <Loader2 className="animate-spin" />}
                      {t("auth.createAccount")}
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={google}>
                      <GoogleMark />
                      {t("auth.googleSignUp")}
                    </Button>
                    <FieldDescription className="px-6 text-center">
                      {t("auth.haveAccount")}{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => go("signIn")}
                      >
                        {t("auth.verify")}
                      </button>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
          <FieldDescription className="px-6 text-center text-xs">{t("auth.doctorsOnly")}</FieldDescription>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-6">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-none sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {mode === "sent" ? <MailCheck className="size-9 text-primary" /> : <LogoMark className="size-9" />}
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              {mode === "sent" ? t("auth.checkEmail") : t("auth.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
        </div>

        <>
            {passwordMode && (
              <>
                <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={google}>
                  <GoogleMark />
                  {t("auth.google")}
                </Button>
                <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {t("auth.or")}
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
              {!codeMode ? (
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
                    autoFocus={!passwordMode}
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
                  {/* shadcn Input OTP: six boxes, paste and SMS/email autofill supported. */}
                  <InputOTP
                    id="code"
                    maxLength={CODE_LENGTH}
                    pattern={REGEXP_ONLY_DIGITS}
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={setCode}
                    containerClassName="justify-center"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "auth-error" : undefined}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2].map((i) => (
                        <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                      ))}
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      {[3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </>
              )}

              {passwordMode && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      {t("auth.password")}
                    </label>
                    {mode === "signIn" && (
                      <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => go("forgot")}>
                        {t("auth.forgot")}
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </>
              )}

              {error && (
                <div id="auth-error" role="alert" className="flex flex-col gap-1">
                  <p className="text-sm text-destructive">{error}</p>
                  {errorDetail && <p className="font-mono text-xs break-words text-muted-foreground">{errorDetail}</p>}
                </div>
              )}

              <Button type="submit" disabled={!canSubmit}>
                {busy && <Loader2 className="animate-spin" />}
                {
                  {
                    signIn: t("auth.verify"),
                    signUp: t("auth.createAccount"),
                    otpEmail: t("auth.sendCode"),
                    otpCode: t("auth.verify"),
                    forgot: t("auth.sendReset"),
                    sent: t("auth.continue"),
                  }[mode]
                }
              </Button>

              {mode === "otpCode" && (
                <div className="flex items-center justify-between gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => go("otpEmail")}>
                    <ArrowLeft className="rtl:rotate-180" />
                    {t("auth.changeEmail")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy || cooldown > 0} onClick={() => void sendCode()}>
                    {cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}
                  </Button>
                </div>
              )}
              {(mode === "otpEmail" || mode === "forgot" || mode === "sent") && back}
            </form>

            {passwordMode && (
              <div className="mt-4 flex flex-col items-center gap-1 text-sm">
                <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => go("otpEmail")}>
                  {t("auth.useCode")}
                </button>
                <p className="text-muted-foreground">
                  {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => go(mode === "signIn" ? "signUp" : "signIn")}>
                    {mode === "signIn" ? t("auth.createAccount") : t("auth.verify")}
                  </button>
                </p>
              </div>
            )}
          </>

        <p className="mt-6 text-center text-xs text-muted-foreground">{t("auth.doctorsOnly")}</p>
      </div>
    </main>
  )
}

/** Minimum length for new passwords (Supabase project setting should match). */
export const MIN_PASSWORD = 10

/** Set while a password-recovery code is being verified, so the sign-in guard routes to /reset-password. */
export const RECOVERY_FLAG = "samvad:recovery"

export type AuthError = { status?: number; code?: string; message?: string }

/** Maps a Supabase auth error to an auth.errors.* translation key. */
export function errorKey(error: AuthError) {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")
    return "auth.errors.rateLimit"
  if (error.code === "invalid_credentials") return "auth.errors.badLogin"
  if (error.code === "email_not_confirmed") return "auth.errors.notConfirmed"
  if (error.code === "user_already_exists" || error.code === "email_exists") return "auth.errors.exists"
  if (error.code === "weak_password") return "auth.errors.weakPassword"
  if (error.code === "same_password") return "auth.errors.samePassword"
  if (error.code === "email_address_not_authorized") return "auth.errors.notAuthorized"
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "auth.errors.badEmail"
  if (error.code === "signup_disabled") return "auth.errors.signupDisabled"
  if (error.code === "provider_disabled") return "auth.errors.providerDisabled"
  if (error.code === "otp_expired" || /expired|invalid/i.test(error.message ?? "")) return "auth.errors.badCode"
  return "auth.errors.generic"
}

/**
 * Password rules shown by the strength meter and required by every form that
 * sets a password. Keep Supabase in step: Authentication → Providers → Email →
 * "Minimum password length" = MIN_PASSWORD and "Password requirements" =
 * lowercase, uppercase, digits and symbols.
 */
export const PASSWORD_RULES = [
  { key: "length", test: (p: string, min: number) => p.length >= min },
  { key: "number", test: (p: string) => /[0-9]/.test(p) },
  { key: "lower", test: (p: string) => /[a-z]/.test(p) },
  { key: "upper", test: (p: string) => /[A-Z]/.test(p) },
  { key: "special", test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
] as const

export const passwordMeetsAll = (password: string, min: number) => PASSWORD_RULES.every((r) => r.test(password, min))

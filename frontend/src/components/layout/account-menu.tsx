import { Headset, Settings } from "lucide-react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { useAuth } from "@/auth/auth-provider"
import { UserMenu, type ThemePreference } from "@/components/arc/user-menu/user-menu"
import { useTheme } from "@/components/theme-provider"

/** uiarc User menu in the top bar: account links, theme, sign out. Bottom sheet on phones. */
export function AccountMenu() {
  const { t } = useTranslation()
  const { user, isLoaded, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  if (!isLoaded || !user) return <span aria-hidden="true" className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />

  const email = user.email ?? ""
  const name = (user.user_metadata?.full_name as string | undefined) || email.split("@")[0] || "—"

  const changeTheme = (next: ThemePreference) => {
    // Cross-fade the whole page where the browser supports it.
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(() => flushSync(() => setTheme(next)))
    } else {
      setTheme(next)
    }
  }

  return (
    <UserMenu
      user={{ name, email }}
      theme={theme}
      onThemeChange={changeTheme}
      items={[
        { label: t("nav.settings"), icon: <Settings size={16} />, onSelect: () => navigate("/settings") },
        { label: t("nav.help"), icon: <Headset size={16} />, onSelect: () => navigate("/help") },
      ]}
      onSignOut={() => signOut().then(() => navigate("/sign-in", { replace: true }))}
      labels={{
        theme: t("common.theme"),
        light: t("common.themeLight"),
        dark: t("common.themeDark"),
        system: t("common.themeSystem"),
        signOut: t("auth.signOut"),
        signingOut: t("auth.signingOut"),
        accountMenu: t("auth.account"),
      }}
    />
  )
}

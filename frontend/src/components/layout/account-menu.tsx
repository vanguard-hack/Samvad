import { Headset, KeyRound, Settings, UserRound } from "lucide-react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { useAuth } from "@/auth/auth-provider"
import { displayName } from "@/auth/display-name"
import { UserMenu, type ThemePreference } from "@/components/arc/user-menu/user-menu"
import { useTheme } from "@/components/theme-provider"

/** uiarc User menu at the sidebar bottom: account links, theme, sign out. Bottom sheet on phones. */
export function AccountMenu({ showName = false, className }: { showName?: boolean; className?: string }) {
  const { t } = useTranslation()
  const { user, isLoaded, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  if (!isLoaded || !user) return <span aria-hidden="true" className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />

  const email = user.email ?? ""
  const name = displayName(user)

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
      showName={showName}
      align="start"
      className={className}
      theme={theme}
      onThemeChange={changeTheme}
      items={[
        { label: t("nav.settings"), icon: <Settings size={16} />, onSelect: () => navigate("/settings") },
        { label: t("nav.profile"), icon: <UserRound size={16} />, onSelect: () => navigate("/profile") },
        { label: t("auth.changePassword"), icon: <KeyRound size={16} />, onSelect: () => navigate("/reset-password") },
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

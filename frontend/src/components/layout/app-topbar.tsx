import { ChevronRight } from "lucide-react"
import { Fragment } from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"

import { LanguageMenu } from "@/components/language-menu"
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch"
import { useTheme } from "@/components/theme-provider"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { breadcrumbFor } from "./nav"

/** uiarc ThemeSwitch (icon only), driven by the shadcn ThemeProvider. */
function TopbarThemeSwitch() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const resolved =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme
  return (
    <ThemeSwitch
      iconOnly
      theme={resolved}
      label={t("common.theme")}
      onThemeChange={(next) => {
        // Cross-fade the whole page where the browser supports it (as in the uiarc docs).
        if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          document.startViewTransition(() => flushSync(() => setTheme(next)))
        } else {
          setTheme(next)
        }
      }}
    />
  )
}

export function AppTopbar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const crumbs = breadcrumbFor(pathname).map((c) => ({ ...c, text: c.literal ? c.label : t(c.label) }))
  const current = crumbs.at(-1)?.text ?? ""

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger className="-ms-1" aria-keyshortcuts="[" />} />
        <TooltipContent>
          {t("nav.toggleSidebar")} <kbd className="ms-1 rounded border px-1">[</kbd>
        </TooltipContent>
      </Tooltip>

      <nav aria-label={t("nav.breadcrumb")} className="min-w-0">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 && (
                  <li aria-hidden="true" className="hidden sm:block">
                    <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                  </li>
                )}
                <li className={last ? "truncate font-medium text-foreground" : "hidden truncate sm:block"}>
                  {c.to && !last ? (
                    <Link to={c.to} className="hover:text-foreground">
                      {c.text}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined}>{c.text}</span>
                  )}
                </li>
              </Fragment>
            )
          })}
        </ol>
      </nav>
      {/* Announce section changes to screen readers. */}
      <p role="status" aria-live="polite" className="sr-only">
        {current}
      </p>

      <div className="ms-auto flex items-center gap-2">
        {/* Search is visual only until the patient API exists (Phase 3). */}
        <Input
          type="search"
          placeholder={t("topbar.search")}
          aria-label={t("topbar.search")}
          className="hidden h-7 w-56 lg:block"
        />
        <LanguageMenu />
        <TopbarThemeSwitch />
      </div>
    </header>
  )
}

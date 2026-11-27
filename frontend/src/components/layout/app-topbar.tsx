import { ChevronRight } from "lucide-react"
import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"

import { LanguageMenu } from "@/components/language-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { breadcrumbFor } from "./nav"

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
        <LanguageMenu />
      </div>
    </header>
  )
}

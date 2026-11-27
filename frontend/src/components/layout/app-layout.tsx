import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Outlet } from "react-router"

import { useAuth } from "@/auth/auth-provider"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { AppTopbar } from "./app-topbar"

/** Collapsed/expanded rail state, remembered per doctor (Supabase user id). */
function useRailState() {
  const { user } = useAuth()
  const key = `samvad.sidebar.${user?.id ?? "anon"}`
  // Keyed by doctor: when the signed-in user changes, the stored value for the
  // new key is read during render (no effect needed).
  const [state, setState] = useState<{ key: string; open: boolean } | null>(null)
  const open = state?.key === key ? state.open : localStorage.getItem(key) !== "false"

  const setOpen = useCallback(
    (next: boolean) => {
      localStorage.setItem(key, String(next))
      setState({ key, open: next })
    },
    [key],
  )
  return [open, setOpen] as const
}

/** "[" folds/unfolds the rail, unless the doctor is typing or inside a menu/dialog. */
function RailShortcut() {
  const { toggleSidebar } = useSidebar()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (
        el?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [role="listbox"]')
      )
        return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar])
  return null
}

/**
 * App shell (App-rail pattern): sidebar that folds into an icon rail, a sheet
 * on phones, breadcrumbs in the top bar, and an inset main panel. The viewport
 * never scrolls; only the panel's content area does, if needed.
 */
export function AppLayout() {
  const { t } = useTranslation()
  const [open, setOpen] = useRailState()

  return (
    <SidebarProvider open={open} onOpenChange={setOpen} className="h-svh overflow-hidden">
      <RailShortcut />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t("common.skipToContent")}
      </a>
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden bg-surface md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:border-border md:peer-data-[variant=inset]:shadow-none">
        <AppTopbar />
        <div id="main" className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

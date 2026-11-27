import { useUser, UserButton } from "@clerk/react"
import { ChevronRight, Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"

import { Logo, LogoMark } from "@/components/brand/logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { CONSULTATION_STEPS } from "@/features/consultation/steps"
import { cn } from "cn"
import { isActivePath, NAV_FOOTER, NAV_GROUPS, type NavGroup, type NavItem } from "./nav"

function NavItems({ items }: { items: NavItem[] }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      {items.map((item) => {
        const label = t(`nav.${item.key}`)
        const active = isActivePath(pathname, item.to)
        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton
              isActive={active}
              tooltip={label}
              aria-current={active ? "page" : undefined}
              render={<Link to={item.to} onClick={() => setOpenMobile(false)} />}
            >
              <item.icon />
              <span>{label}</span>
            </SidebarMenuButton>
            {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

/** A nav group whose header expands/collapses it. In rail mode items always show as icons. */
function NavGroupSection({ group }: { group: NavGroup }) {
  const { t } = useTranslation()
  const { state, isMobile } = useSidebar()
  const [expanded, setExpanded] = useState(true)
  const rail = state === "collapsed" && !isMobile
  const contentId = `nav-group-${group.key}`

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        render={
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((v) => !v)}
          />
        }
        className="w-full cursor-pointer justify-between hover:text-sidebar-foreground"
      >
        {t(`nav.groups.${group.key}`)}
        <ChevronRight className={cn("transition-transform", expanded && "rotate-90", "rtl:-scale-x-100")} />
      </SidebarGroupLabel>
      {(expanded || rail) && (
        <SidebarGroupContent id={contentId}>
          <NavItems items={group.items} />
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { t } = useTranslation()
  const { user, isLoaded } = useUser()
  const { state, setOpenMobile } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" aria-label={t("app.name")} />}>
              {collapsed ? <LogoMark className="size-5" /> : <Logo />}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("nav.newConsultation")}
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              render={<Link to={CONSULTATION_STEPS[0].path} onClick={() => setOpenMobile(false)} />}
            >
              <Plus />
              <span>{t("nav.newConsultation")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.key} group={group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavItems items={NAV_FOOTER} />
        <SidebarMenu>
          <SidebarMenuItem>
            {isLoaded ? (
              <div className="flex items-center gap-2 p-1">
                <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
                {!collapsed && (
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{user?.fullName || user?.username || "—"}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user?.primaryEmailAddress?.emailAddress}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <SidebarMenuSkeleton showIcon />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Drag/click edge to fold the rail. */}
      <SidebarRail />
    </Sidebar>
  )
}

import { ChevronRight } from "lucide-react"
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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "cn"
import { AccountMenu } from "./account-menu"
import { isActivePath, NAV_GROUPS, type NavGroup, type NavItem } from "./nav"

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
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="[&_svg]:size-7 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&_svg]:size-5"
              render={<Link to="/" aria-label={t("app.name")} />}
            >
              {collapsed ? <LogoMark className="size-5" /> : <Logo />}
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
        <AccountMenu showName={!collapsed} className="w-full min-w-0" />
      </SidebarFooter>

      {/* Drag/click edge to fold the rail. */}
      <SidebarRail />
    </Sidebar>
  )
}

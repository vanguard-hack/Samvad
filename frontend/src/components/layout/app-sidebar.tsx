import { ChevronRight, ChevronsUpDown, LogOut, Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router"

import { useAuth } from "@/auth/auth-provider"
import { Logo, LogoMark } from "@/components/brand/logo"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  const { user, isLoaded, signOut } = useAuth()
  const navigate = useNavigate()
  const email = user?.email ?? ""
  const name = (user?.user_metadata?.full_name as string | undefined) || email.split("@")[0] || "—"
  const initials = name.slice(0, 2).toUpperCase()
  const { state, setOpenMobile } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="[&_svg]:size-7 group-data-[collapsible=icon]:[&_svg]:size-5"
              render={<Link to="/" aria-label={t("app.name")} />}
            >
              {collapsed ? <LogoMark className="size-5" /> : <Logo />}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("nav.newConsultation")}
              className="w-fit px-3 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SidebarMenuButton size="lg" tooltip={email} aria-label={t("auth.account")} />}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {initials}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">{email}</span>
                  </span>
                  <ChevronsUpDown className="ms-auto" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void signOut().then(() => navigate("/sign-in", { replace: true }))
                    }}
                  >
                    <LogOut />
                    {t("auth.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

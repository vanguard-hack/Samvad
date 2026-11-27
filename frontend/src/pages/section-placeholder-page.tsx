import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import type { NavItem } from "@/components/layout/nav"
import { Button } from "@/components/ui/button"

/** Placeholder for sidebar sections that a later phase delivers. */
export function SectionPlaceholderPage({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const name = t(`nav.${item.key}`)
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <item.icon className="size-8 text-primary" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-balance">{t("section.title", { name, n: item.phase ?? "—" })}</h1>
      <p className="text-sm text-muted-foreground">{t("section.body")}</p>
      <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
        <ArrowLeft className="rtl:rotate-180" />
        {t("section.back")}
      </Button>
    </section>
  )
}

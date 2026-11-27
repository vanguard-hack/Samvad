import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, Navigate, useParams } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getStep } from "@/features/consultation/steps"

export function StepPlaceholderPage() {
  const { t } = useTranslation()
  const step = getStep(useParams().stepId)
  if (!step) return <Navigate to="/" replace />

  const title = t(`steps.${step.id}.title`)
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-16 text-center">
      <step.icon className="size-8 text-primary" aria-hidden="true" />
      <Badge variant="secondary">
        {step.number} / 6 · {title}
      </Badge>
      <h1 className="text-lg font-semibold text-balance">{t("placeholder.title", { step: title, n: step.phase })}</h1>
      <p className="text-sm text-muted-foreground">{t("placeholder.body")}</p>
      <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
        <ArrowLeft className="rtl:rotate-180" />
        {t("placeholder.back")}
      </Button>
    </section>
  )
}

import { TriangleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Shown instead of crashing when the Clerk key is missing. */
export function ConfigErrorPage() {
  const { t } = useTranslation()
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center">
        <span className="grid size-9 place-items-center rounded-full bg-danger-soft text-danger">
          <TriangleAlertIcon className="size-5" aria-hidden="true" />
        </span>
        <h1 className="text-base font-semibold">{t('config.missingKeyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('config.missingKeyBody')}</p>
      </div>
    </main>
  )
}

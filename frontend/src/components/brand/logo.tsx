import { useTranslation } from 'react-i18next'
import { cn } from 'cn'

/** Two overlapping speech bubbles: one voice in, one voice out. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7', className)}>
      <path
        d="M4 7.5A4.5 4.5 0 0 1 8.5 3h9A4.5 4.5 0 0 1 22 7.5v5a4.5 4.5 0 0 1-4.5 4.5H11l-4.6 3.6c-.6.5-1.4 0-1.4-.7V16.4A4.5 4.5 0 0 1 4 13.5z"
        className="fill-primary"
      />
      <path
        d="M28 16.5a4.5 4.5 0 0 0-4.5-4.5h-.5v1.5a6 6 0 0 1-6 6h-3v.5a4.5 4.5 0 0 0 4.5 4.5H21l4.6 3.6c.6.5 1.4 0 1.4-.7v-3.5a4.5 4.5 0 0 0 1-2.9z"
        className="fill-foreground"
      />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-display">{t('app.name')}</span>
    </span>
  )
}

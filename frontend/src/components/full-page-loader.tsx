import { useTranslation } from "react-i18next"

import { Skeleton } from "@/components/ui/skeleton"

/** Shown while Clerk loads: a skeleton of the app shell. */
export function FullPageLoader() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-live="polite" className="flex h-svh gap-2 bg-sidebar p-2">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="hidden w-64 flex-col gap-3 p-2 md:flex">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-full" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 rounded-xl border bg-surface p-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

// Password field with strength meter, after ReUI c-input-23
// (https://reui.io/components/input/c-input-23). Adapted: lucide icons instead of
// ReUI's IconPlaceholder, translated text, length rule driven by MIN_PASSWORD.
import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "lucide-react"
import { useId, useState, type ComponentProps } from "react"
import { useTranslation } from "react-i18next"

import { PASSWORD_RULES } from "@/auth/password-rules"
import { Input } from "@/components/ui/input"
import { cn } from "cn"

const RULES = PASSWORD_RULES

const BAR_COLOR = ["bg-border", "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-green-500", "bg-emerald-500"]

type Props = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
  minLength: number
}

export function PasswordStrengthInput({ value, onValueChange, minLength, id, className, ...props }: Props) {
  const { t } = useTranslation()
  const autoId = useId()
  const inputId = id ?? autoId
  const [visible, setVisible] = useState(false)

  const results = RULES.map((r) => ({ key: r.key, met: r.test(value, minLength) }))
  const score = results.filter((r) => r.met).length
  const label =
    score === 0 ? t("password.enter") : score <= 2 ? t("password.weak") : score <= 4 ? t("password.medium") : t("password.strong")

  return (
    <div className="flex flex-col">
      <div className="relative">
        <Input
          {...props}
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          aria-describedby={`${inputId}-strength`}
          className={cn("pe-9", className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-controls={inputId}
          aria-label={visible ? t("password.hide") : t("password.show")}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-sm text-muted-foreground/80 outline-none transition-[color,box-shadow] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {visible ? <EyeOffIcon className="size-3.5" aria-hidden="true" /> : <EyeIcon className="size-3.5" aria-hidden="true" />}
        </button>
      </div>

      <div
        role="progressbar"
        aria-label={t("password.strength")}
        aria-valuemin={0}
        aria-valuemax={RULES.length}
        aria-valuenow={score}
        className="mt-3 mb-3 flex gap-1"
      >
        {RULES.map((r, i) => (
          <div
            key={r.key}
            className={cn("h-1 flex-1 rounded-full transition-colors duration-500", i < score ? BAR_COLOR[score] : "bg-border")}
          />
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <p id={`${inputId}-strength`} className="text-sm font-medium text-foreground">
          {label}
        </p>
        <span className="text-xs text-muted-foreground">{t("password.met", { n: score, total: RULES.length })}</span>
      </div>

      <ul aria-label={t("password.requirements")} className="space-y-1.5">
        {results.map((r) => (
          <li key={r.key} className="flex items-center gap-1">
            {r.met ? (
              <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
            ) : (
              <XIcon className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
            )}
            <span className={cn("text-xs transition-colors", r.met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
              {t(`password.rules.${r.key}`, { n: minLength })}
              <span className="sr-only"> — {r.met ? t("password.ruleMet") : t("password.ruleNotMet")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Interface-language picker after shadcn.io "dropdown-menu-language-selector"
// (outline Button + DropdownMenu radio group), with Badge for translation status.
import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getLanguage, LANGUAGES } from "@/i18n/languages"

export function LanguageMenu() {
  const { t, i18n } = useTranslation()
  const current = getLanguage(i18n.language)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={`${t("common.interfaceLanguage")}: ${current.englishName}`}
      >
        <Languages />
        <span>{current.englishName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("common.interfaceLanguage")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current.code}
          onValueChange={(code) => void i18n.changeLanguage(code as string)}
        >
          {LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code} className="gap-2">
              {/* Script sample in place of the example's flag: every language here is Indian, so flags would all match. */}
              <span aria-hidden="true" lang={lang.code} className="w-5 shrink-0 text-center text-muted-foreground">
                {Array.from(lang.nativeName)[0]}
              </span>
              <span>{lang.englishName}</span>
              {lang.code !== "en" && (
                <span lang={lang.code} dir={lang.dir} className="text-muted-foreground">
                  {lang.nativeName}
                </span>
              )}
              {lang.ui === "draft" && (
                <Badge variant="outline" className="ms-auto" title={t("common.draftTranslationHint")}>
                  {t("common.draftTranslation")}
                </Badge>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { ArrowUp, Square } from "lucide-react"
import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const MAX_LENGTH = 500

/** The aurora border from the "Generate report" button, shown while the composer has focus. */
const FOCUS_AURORA =
  "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:p-px before:bg-linear-to-r before:from-sky-500 before:via-fuchsia-500 before:to-amber-400 before:opacity-0 before:transition-opacity before:duration-300 before:content-[''] before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] focus-within:before:opacity-100"

export interface ComposerHandle {
  focus: () => void
}

type Props = {
  onSend: (text: string) => void
  onStop: () => void
  pending: boolean
  autoFocus?: boolean
  ref?: Ref<ComposerHandle>
}

export function ChatComposer({ onSend, onStop, pending, autoFocus, ref }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState("")
  const area = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), [])

  // Grow with the text up to the max height, then scroll.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const submit = () => {
    if (pending || !value.trim()) return
    onSend(value)
    setValue("")
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={cn(
        "relative rounded-2xl border bg-card shadow-sm transition-shadow focus-within:border-transparent focus-within:shadow-md",
        FOCUS_AURORA,
      )}
    >
      <textarea
        ref={area}
        rows={1}
        value={value}
        maxLength={MAX_LENGTH}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is a new line; never interrupt an IME composition.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        aria-label={t("assistant.composer.label")}
        placeholder={t("assistant.composer.placeholder")}
        className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <p className="hidden text-[11px] text-muted-foreground sm:block">{t("assistant.composer.hint")}</p>
        <span className="ms-auto flex items-center gap-2">
          {value.length > MAX_LENGTH * 0.8 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {value.length}/{MAX_LENGTH}
            </span>
          )}
          {pending ? (
            <Button type="button" size="icon-sm" variant="secondary" className="rounded-full" onClick={onStop}>
              <Square className="size-3 fill-current" />
              <span className="sr-only">{t("assistant.composer.stop")}</span>
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" className="rounded-full" disabled={!value.trim()}>
              <ArrowUp />
              <span className="sr-only">{t("assistant.composer.send")}</span>
            </Button>
          )}
        </span>
      </div>
    </form>
  )
}

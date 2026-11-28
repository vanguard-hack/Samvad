import { Loader2, MessagesSquare, UserRound } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { LogoMark } from "@/components/brand/logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  listMessages,
  listSessions,
  LOG_EVENT,
  type AssistantMessage,
  type AssistantSession,
} from "@/features/assistant/conversations-api"
import { getLanguage } from "@/i18n/languages"
import { cn } from "@/lib/utils"

/**
 * Every voice-assistant session as a chat: sessions on the left (newest first),
 * the selected conversation on the right. A session runs from opening the
 * assistant (Ctrl+Space) to closing it. Updates live while a session is going.
 */
export function ConversationsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [sessions, setSessions] = useState<AssistantSession[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [error, setError] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const loadSessions = useCallback(async () => {
    try {
      const list = await listSessions()
      setSessions(list)
      setSelected((cur) => cur ?? list[0]?.id ?? null)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadChat = useCallback(async (id: string) => {
    try {
      setMessages(await listMessages(id))
    } catch {
      setError(true)
    } finally {
      setLoadingChat(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!selected) return
    setLoadingChat(true)
    void loadChat(selected)
  }, [selected, loadChat])

  // A session in progress: refresh as each turn is saved.
  useEffect(() => {
    const onLog = (e: Event) => {
      void loadSessions()
      const id = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId
      if (id && id === selected) void loadChat(id)
    }
    window.addEventListener(LOG_EVENT, onLog)
    return () => window.removeEventListener(LOG_EVENT, onLog)
  }, [selected, loadSessions, loadChat])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [messages])

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })
  const current = sessions.find((s) => s.id === selected)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-semibold">{t("conversations.title")}</h1>
        <p className="text-xs text-muted-foreground">{t("conversations.subtitle")}</p>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {t("conversations.loadError")}
          <Button variant="outline" size="xs" onClick={() => void loadSessions()}>
            {t("patients.retry")}
          </Button>
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </p>
      ) : sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <MessagesSquare className="size-8" aria-hidden="true" />
          <p>{t("conversations.empty")}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[16rem_1fr]">
          {/* Sessions */}
          <nav aria-label={t("conversations.sessions")} className="flex min-h-0 flex-col overflow-y-auto rounded-lg border bg-background p-1 max-md:max-h-48">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                aria-current={s.id === selected ? "true" : undefined}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  s.id === selected ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="line-clamp-1 text-xs font-medium">{s.title || t("conversations.untitled")}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {when(s.started_at)} · {t("conversations.messages", { count: s.message_count })}
                  {!s.ended_at && (
                    <Badge variant="outline" className="h-4 border-primary/40 px-1 text-[10px] text-primary">
                      {t("conversations.live")}
                    </Badge>
                  )}
                </span>
              </button>
            ))}
          </nav>

          {/* Chat */}
          <section aria-label={t("conversations.chat")} className="flex min-h-0 flex-col rounded-lg border bg-background">
            {current && (
              <header className="border-b px-4 py-2.5">
                <p className="line-clamp-1 text-sm font-medium">{current.title || t("conversations.untitled")}</p>
                <p className="text-[11px] text-muted-foreground">
                  {when(current.started_at)}
                  {current.ended_at ? ` – ${time(current.ended_at)}` : ` · ${t("conversations.live")}`}
                </p>
              </header>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {loadingChat && messages.length === 0 ? (
                <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
              ) : (
                messages.map((m) => {
                  const mine = m.role === "user"
                  const l = m.language ? getLanguage(m.language) : null
                  return (
                    <div key={m.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full",
                          mine ? "bg-primary/10 text-primary" : "bg-muted",
                        )}
                        aria-hidden="true"
                      >
                        {mine ? <UserRound className="size-3.5" /> : <LogoMark className="size-3.5" />}
                      </span>
                      <div className={cn("flex max-w-[75%] flex-col gap-0.5", mine && "items-end")}>
                        <div
                          lang={m.language ?? undefined}
                          dir={l?.dir}
                          className={cn(
                            "rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                            mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
                          )}
                        >
                          {m.text}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {mine ? t("conversations.you") : "Samvad"} · {time(m.created_at)}
                          {l && l.code !== "en" ? ` · ${l.englishName}` : ""}
                          {m.interrupted ? ` · ${t("conversations.interrupted")}` : ""}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottom} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from "react"

import {
  EMPTY_CONTEXT,
  type AssistantEngine,
  type AssistantReply,
  type ChatMessage,
  type ConversationContext,
} from "@/features/assistant/types"

/** Per tab: the conversation survives moving between pages, not closing the tab. */
const STORAGE_KEY = "samvad.assistant.chat"

interface ChatState {
  messages: ChatMessage[]
  context: ConversationContext
}

const EMPTY_STATE: ChatState = { messages: [], context: EMPTY_CONTEXT }

function restore(): ChatState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ChatState> | null
    if (saved && Array.isArray(saved.messages) && saved.context && typeof saved.context === "object") {
      return { messages: saved.messages, context: { ...EMPTY_CONTEXT, ...saved.context } }
    }
  } catch {
    // Unreadable or from an older shape: start a new conversation.
  }
  return EMPTY_STATE
}

const newId = () => crypto.randomUUID()

const STOPPED_REPLY: AssistantReply = { text: [{ key: "stopped" }], blocks: [], suggestions: [] }

/**
 * A multi-turn conversation with an `AssistantEngine`: the messages, the
 * context the engine carries between turns, and one question in flight at a time.
 */
export function useAssistantChat(engine: AssistantEngine) {
  const [state, setState] = useState(restore)
  const [pending, setPending] = useState(false)
  // Messages older than this were restored, so they appear without animating again.
  const [openedAt] = useState(() => Date.now())
  const context = useRef(state.context)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage full or blocked: the chat still works for this visit.
    }
  }, [state])

  useEffect(() => () => inFlight.current?.abort(), [])

  const append = (message: ChatMessage, next?: ConversationContext) =>
    setState((s) => ({ messages: [...s.messages, message], context: next ?? s.context }))

  const ask = useCallback(
    async (query: string) => {
      const controller = new AbortController()
      inFlight.current = controller
      setPending(true)
      try {
        const res = await engine.respond({ query, context: context.current }, controller.signal)
        context.current = res.context
        append({ id: newId(), role: "assistant", reply: res.reply, at: Date.now() }, res.context)
      } catch {
        if (inFlight.current !== controller) return // the chat was reset meanwhile
        if (controller.signal.aborted) append({ id: newId(), role: "assistant", reply: STOPPED_REPLY, at: Date.now() })
        else append({ id: newId(), role: "error", query, at: Date.now() })
      } finally {
        if (inFlight.current === controller) inFlight.current = null
        setPending(false)
      }
    },
    [engine],
  )

  /** Sends `text` as the doctor's message; `query` is what the engine reads (a suggestion's canonical wording). */
  const send = useCallback(
    (text: string, query: string = text) => {
      const shown = text.trim()
      if (!shown || inFlight.current) return
      append({ id: newId(), role: "user", text: shown, at: Date.now() })
      void ask(query.trim())
    },
    [ask],
  )

  const retry = useCallback(
    (errorId: string) => {
      const failed = state.messages.find((m) => m.id === errorId)
      if (!failed || failed.role !== "error" || inFlight.current) return
      setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== errorId) }))
      void ask(failed.query)
    },
    [ask, state.messages],
  )

  const stop = useCallback(() => inFlight.current?.abort(), [])

  const reset = useCallback(() => {
    inFlight.current?.abort()
    inFlight.current = null
    context.current = EMPTY_CONTEXT
    setState(EMPTY_STATE)
  }, [])

  return { messages: state.messages, pending, openedAt, send, retry, stop, reset }
}

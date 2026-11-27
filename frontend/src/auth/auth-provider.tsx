import type { Session, User } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { supabase } from "@/lib/supabase"

interface AuthState {
  session: Session | null
  user: User | null
  /** False until the stored session has been read on startup. */
  isLoaded: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** Doctor accounts only — patients never sign in. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setIsLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setIsLoaded(true)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoaded,
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }),
    [session, isLoaded],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

import { createClient } from "@supabase/supabase-js"

/**
 * Browser Supabase client. Both values are public by design (they ship in the
 * bundle); data is protected by Supabase Auth + row-level security.
 * NEVER put the secret / service_role key in a VITE_* variable.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const SUPABASE_CONFIGURED = Boolean(url && key)

export const supabase = SUPABASE_CONFIGURED
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null

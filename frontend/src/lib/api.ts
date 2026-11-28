import { supabase } from "@/lib/supabase"

/** The signed-in doctor's Supabase access token (refreshed by supabase-js). */
export async function accessToken(): Promise<string> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) throw new ApiError(401, "Sign in required")
  return token
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Calls the Samvad backend (/api/*) with the doctor's token. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${await accessToken()}`)
  const res = await fetch(`/api${path}`, { ...init, headers, cache: "no-store" })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail)
  }
  return res
}

/** Sarvam language codes back to Samvad's ("hi-IN" → "hi", "od-IN" → "or", "kok-IN" → "gom"). */
export function fromSarvamCode(code: string | null | undefined): string | null {
  if (!code) return null
  const base = code.split("-")[0]
  return base === "od" ? "or" : base === "kok" ? "gom" : base
}

/** Speaks text in Samvad's voice. Returns WAV audio. */
export async function speak(text: string, language: string): Promise<Blob> {
  const res = await api("/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  })
  return res.blob()
}

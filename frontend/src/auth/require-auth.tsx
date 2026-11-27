import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"

import { RECOVERY_FLAG } from "@/auth/auth-errors"
import { useAuth } from "@/auth/auth-provider"
import { FullPageLoader } from "@/components/full-page-loader"

/** Gate for every doctor-only route. Signed-out users go to /sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useAuth()
  const location = useLocation()

  if (!isLoaded) return <FullPageLoader />
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

/** Inverse gate: a signed-in doctor visiting /sign-in goes straight home. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useAuth()
  if (isLoaded && user) return <Navigate to={sessionStorage.getItem(RECOVERY_FLAG) ? "/reset-password" : "/"} replace />
  return <>{children}</>
}

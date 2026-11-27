import type { ReactNode } from 'react'
import { useAuth } from '@clerk/react'
import { Navigate, useLocation } from 'react-router'
import { FullPageLoader } from '@/components/full-page-loader'

/** Gate for every doctor-only route. Signed-out users go to /sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  const location = useLocation()

  if (!isLoaded) return <FullPageLoader />
  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/** Inverse gate: a signed-in doctor visiting /sign-in goes straight home. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  if (isLoaded && isSignedIn) return <Navigate to="/" replace />
  return <>{children}</>
}

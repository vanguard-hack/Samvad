import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { ClerkProvider } from '@clerk/react'
import { shadcn } from '@clerk/ui/themes'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { getLanguage, type ClerkLocaleKey } from '@/i18n/languages'

type LocalizationResource = NonNullable<ComponentProps<typeof ClerkProvider>['localization']>

/**
 * @clerk/localizations ships every locale in one module (~460 KB), so it is
 * loaded lazily and only for the four Indian locales Clerk supports. English
 * is Clerk's built-in default and needs nothing.
 */
function useClerkLocalization(key: ClerkLocaleKey) {
  const [loaded, setLoaded] = useState<{ key: ClerkLocaleKey; value: LocalizationResource }>()
  useEffect(() => {
    if (key === 'enUS') return
    let cancelled = false
    void import('@clerk/localizations').then((m) => {
      if (!cancelled) setLoaded({ key, value: m[key] })
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return key !== 'enUS' && loaded?.key === key ? loaded.value : undefined
}

export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

/**
 * Clerk is used for doctor accounts only — patients never sign in.
 * Must render inside <BrowserRouter> so Clerk navigates with React Router.
 */
export function ClerkProviderWithRouter({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const localization = useClerkLocalization(getLanguage(i18n.language).clerk)

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY!}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
      localization={localization}
      appearance={{
        theme: shadcn,
        variables: { fontFamily: 'inherit', borderRadius: '11px' },
        elements: {
          // DESIGN: no shadows on cards; the pill is the action signal.
          rootBox: 'w-full max-w-[25rem]',
          cardBox: 'shadow-none! border border-border rounded-xl w-full max-w-full',
          card: 'shadow-none',
          formButtonPrimary: 'rounded-full active:scale-[0.97]',
          socialButtonsBlockButton: 'rounded-full',
          footerActionLink: 'text-link',
        },
      }}
    >
      {children}
    </ClerkProvider>
  )
}

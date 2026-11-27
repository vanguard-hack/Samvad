import { SignIn, SignUp } from '@clerk/react'

type Mode = 'sign-in' | 'sign-up'

/** Sign-in / sign-up: the Clerk card only, centred in one viewport. */
export function SignInPage({ mode = 'sign-in' }: { mode?: Mode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6">
      {mode === 'sign-in' ? (
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
      ) : (
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
      )}
    </main>
  )
}

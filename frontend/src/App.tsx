import { UserRoundIcon } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router'
import { RedirectIfSignedIn, RequireAuth } from '@/auth/require-auth'
import { AppLayout } from '@/components/layout/app-layout'
import { ALL_NAV_ITEMS } from '@/components/layout/nav'
import { InterpreterPage } from '@/pages/interpreter-page'
import { PatientsPage } from '@/pages/patients-page'
import { SectionPlaceholderPage } from '@/pages/section-placeholder-page'
import { SignInPage } from '@/pages/sign-in-page'
import { StepPlaceholderPage } from '@/pages/step-placeholder-page'

/** Sidebar sections that are still placeholders (they carry a delivery phase). */
const PLACEHOLDER_SECTIONS = ALL_NAV_ITEMS.filter((i) => i.phase !== undefined)

export default function App() {
  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <RedirectIfSignedIn>
            <SignInPage />
          </RedirectIfSignedIn>
        }
      />
      {/* Supabase creates the account on first sign-in, so there is no separate sign-up. */}
      <Route path="/sign-up" element={<Navigate to="/sign-in" replace />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        {/* Patients is the home screen; /patients kept as an alias. */}
        <Route index element={<PatientsPage />} />
        <Route path="patients" element={<Navigate to="/" replace />} />
        <Route path="interpreter" element={<InterpreterPage />} />
        <Route
          path="patients/:patientId"
          element={
            <SectionPlaceholderPage
              item={{ key: 'patients', to: '/', icon: UserRoundIcon, phase: 3 }}
            />
          }
        />
        {PLACEHOLDER_SECTIONS.map((item) => (
          <Route key={item.key} path={item.to.slice(1)} element={<SectionPlaceholderPage item={item} />} />
        ))}
        <Route path="consult/:stepId" element={<StepPlaceholderPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

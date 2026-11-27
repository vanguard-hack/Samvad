import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { DirectionProvider } from "@base-ui/react/direction-provider"
import { useTranslation } from "react-i18next"
import { BrowserRouter } from "react-router"
import "@/i18n"
import "./index.css"
import App from "./App"
import { CLERK_PUBLISHABLE_KEY, ClerkProviderWithRouter } from "@/auth/clerk-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { effectiveUiLanguage } from "@/i18n"
import { ConfigErrorPage } from "@/pages/config-error-page"

/** Base UI popups need the reading direction for RTL scripts (Urdu, Kashmiri, Sindhi). */
function DirectionRoot({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()
  return <DirectionProvider direction={effectiveUiLanguage(i18n.language).dir}>{children}</DirectionProvider>
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* storageKey matches the pre-paint script in index.html */}
    <ThemeProvider defaultTheme="light" storageKey="samvaad.theme">
      <DirectionRoot>
        <TooltipProvider>
          {CLERK_PUBLISHABLE_KEY ? (
            <BrowserRouter>
              <ClerkProviderWithRouter>
                <App />
              </ClerkProviderWithRouter>
            </BrowserRouter>
          ) : (
            <ConfigErrorPage />
          )}
        </TooltipProvider>
      </DirectionRoot>
    </ThemeProvider>
  </StrictMode>,
)

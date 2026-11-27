import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, getLanguage, LANGUAGES } from './languages'
import en from './locales/en.json'
import hi from './locales/hi.json'
import kn from './locales/kn.json'
import ta from './locales/ta.json'

export const STORAGE_KEY = 'samvaad.uiLanguage'

/**
 * The language whose strings are actually on screen. A language with no
 * interface translation shows English, so the document must say `lang="en"`
 * (screen readers and font selection depend on it) even though the doctor
 * picked, say, Bengali.
 */
export function effectiveUiLanguage(code: string | undefined) {
  const lang = getLanguage(code)
  return lang.ui === 'none' ? getLanguage(DEFAULT_LANGUAGE) : lang
}

function applyDocumentLanguage(code: string) {
  const shown = effectiveUiLanguage(code)
  document.documentElement.lang = shown.code
  document.documentElement.dir = shown.dir
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      kn: { translation: kn },
      ta: { translation: ta },
    },
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng', // e.g. /sign-in?lng=hi — handy for demos
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  })

i18n.on('languageChanged', applyDocumentLanguage)
applyDocumentLanguage(i18n.language ?? DEFAULT_LANGUAGE)

export default i18n

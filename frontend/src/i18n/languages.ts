/**
 * The 22 scheduled languages of the Indian Constitution (Eighth Schedule) plus
 * English.
 *
 * `voice`  — STT + TTS coverage we expect from the speech providers. A
 *            language with `voice: false` must NEVER be offered as a voice
 *            interpretation language; the patient flow routes it to picture
 *            mode and asks for a human interpreter instead.
 * `ui`     — state of the interface translation:
 *            'reviewed' = checked by a native speaker
 *            'draft'    = machine/AI drafted, NOT yet reviewed (shown with a badge)
 *            'none'     = falls back to English
 */
export type UiTranslationStatus = 'reviewed' | 'draft' | 'none'

export interface Language {
  code: string
  englishName: string
  nativeName: string
  script: string
  dir: 'ltr' | 'rtl'
  voice: boolean
  ui: UiTranslationStatus
}

export const LANGUAGES: Language[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', script: 'Latin', dir: 'ltr', voice: true, ui: 'reviewed' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', dir: 'ltr', voice: true, ui: 'draft' },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'te', englishName: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'mr', englishName: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'ta', englishName: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', dir: 'ltr', voice: true, ui: 'draft' },
  { code: 'ur', englishName: 'Urdu', nativeName: 'اردو', script: 'Perso-Arabic', dir: 'rtl', voice: false, ui: 'none' },
  { code: 'gu', englishName: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'kn', englishName: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', dir: 'ltr', voice: true, ui: 'draft' },
  { code: 'or', englishName: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'ml', englishName: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'pa', englishName: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', dir: 'ltr', voice: true, ui: 'none' },
  { code: 'as', englishName: 'Assamese', nativeName: 'অসমীয়া', script: 'Bengali–Assamese', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'mai', englishName: 'Maithili', nativeName: 'मैथिली', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'sat', englishName: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'ks', englishName: 'Kashmiri', nativeName: 'کٲشُر', script: 'Perso-Arabic', dir: 'rtl', voice: false, ui: 'none' },
  { code: 'ne', englishName: 'Nepali', nativeName: 'नेपाली', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'gom', englishName: 'Konkani', nativeName: 'कोंकणी', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'sd', englishName: 'Sindhi', nativeName: 'سنڌي', script: 'Perso-Arabic', dir: 'rtl', voice: false, ui: 'none' },
  { code: 'doi', englishName: 'Dogri', nativeName: 'डोगरी', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'mni', englishName: 'Manipuri', nativeName: 'ꯃꯩꯇꯩꯂꯣꯟ', script: 'Meetei Mayek', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'brx', englishName: 'Bodo', nativeName: 'बड़ो', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
  { code: 'sa', englishName: 'Sanskrit', nativeName: 'संस्कृतम्', script: 'Devanagari', dir: 'ltr', voice: false, ui: 'none' },
]

export const DEFAULT_LANGUAGE = 'en'

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]))

export function getLanguage(code: string | undefined): Language {
  const base = code?.split('-')[0]
  return (base && byCode.get(base)) || byCode.get(DEFAULT_LANGUAGE)!
}

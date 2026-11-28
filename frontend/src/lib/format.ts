import { effectiveUiLanguage } from '@/i18n'

/** Intl locale for the language whose strings are on screen (en-IN, hi-IN, …). */
export function intlLocale(uiLanguage: string) {
  return `${effectiveUiLanguage(uiLanguage).code}-IN`
}

export function formatLongDate(date: Date, uiLanguage: string) {
  return new Intl.DateTimeFormat(intlLocale(uiLanguage), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/** "09:40" → "9:40 AM" in the doctor's locale. */
export function formatClock(hhmm: string, uiLanguage: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return new Intl.DateTimeFormat(intlLocale(uiLanguage), { hour: 'numeric', minute: '2-digit' }).format(d)
}

/** Monday-first short weekday names. */
export function weekdayNames(uiLanguage: string) {
  const fmt = new Intl.DateTimeFormat(intlLocale(uiLanguage), { weekday: 'short' })
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
}

/** 0 = Monday … 6 = Sunday. */
export function todayIndexMondayFirst() {
  return (new Date().getDay() + 6) % 7
}

/** Whole days between an ISO date (yyyy-mm-dd) and today. */
export function daysSince(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - then.getTime()) / 86_400_000)
}

/** ISO date (yyyy-mm-dd) → "28 Nov 2026" in the doctor's locale. */
export function formatShortDate(iso: string, uiLanguage: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(intlLocale(uiLanguage), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d))
}

/** ISO date (yyyy-mm-dd) → "Fri, 4 Dec" in the doctor's locale. */
export function formatWeekdayDate(iso: string, uiLanguage: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(intlLocale(uiLanguage), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d))
}

/** "09:00", "09:30" → "9:00 AM - 9:30 AM". */
export function formatTimeSlot(start: string, end: string, uiLanguage: string) {
  return `${formatClock(start, uiLanguage)} - ${formatClock(end, uiLanguage)}`
}

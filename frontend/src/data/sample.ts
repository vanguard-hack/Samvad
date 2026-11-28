/** Patient types shared by the patients pages and the assistant, and a local-date helper. */

export type Sex = 'F' | 'M' | 'O'
export type PatientStatus = 'active' | 'followUp' | 'needsReview'

export interface SamplePatient {
  id: string
  /** Route id for /patients/:ref (database uuid). Falls back to `id`. */
  ref?: string
  /** Kept in memory only (consent declined, Critical Rule 3). */
  unsaved?: boolean
  name: string
  age: number
  sex: Sex
  phone: string
  language: string // LANGUAGES code
  lastVisit: string // ISO date
  visits: number
  status: PatientStatus
}

/** Local ISO date n days before today (negative n is in the future). */
export const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  // Local date, not toISOString(): IST is UTC+5:30, so UTC would be a day off after midnight.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

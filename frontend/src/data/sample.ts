/**
 * SAMPLE DATA — UI prototype only. Replaced by the API in the backend phase.
 * Names are fictional; phone numbers are masked as they will be in the real
 * UI (doctors rarely need the full number on screen).
 */

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

export const SAMPLE_PATIENTS: SamplePatient[] = [
  { id: 'SMV-1001', name: 'Lakshmi Narayan', age: 58, sex: 'F', phone: '+91 ••••• ••214', language: 'kn', lastVisit: daysAgo(0), visits: 7, status: 'needsReview' },
  { id: 'SMV-1002', name: 'Srinivas Rao', age: 46, sex: 'M', phone: '+91 ••••• ••587', language: 'te', lastVisit: daysAgo(0), visits: 12, status: 'active' },
  { id: 'SMV-1003', name: 'Meenakshi Sundaram', age: 63, sex: 'F', phone: '+91 ••••• ••903', language: 'ta', lastVisit: daysAgo(21), visits: 5, status: 'followUp' },
  { id: 'SMV-1004', name: 'Mohammed Irfan', age: 39, sex: 'M', phone: '+91 ••••• ••346', language: 'ur', lastVisit: daysAgo(0), visits: 1, status: 'active' },
  { id: 'SMV-1005', name: 'Priya Sharma', age: 29, sex: 'F', phone: '+91 ••••• ••772', language: 'hi', lastVisit: daysAgo(0), visits: 3, status: 'needsReview' },
  { id: 'SMV-1006', name: 'Anjali Das', age: 34, sex: 'F', phone: '+91 ••••• ••128', language: 'bn', lastVisit: daysAgo(14), visits: 2, status: 'active' },
  { id: 'SMV-1007', name: 'Rajesh Patil', age: 52, sex: 'M', phone: '+91 ••••• ••655', language: 'mr', lastVisit: daysAgo(3), visits: 9, status: 'followUp' },
  { id: 'SMV-1008', name: 'Gurpreet Kaur', age: 44, sex: 'F', phone: '+91 ••••• ••410', language: 'pa', lastVisit: daysAgo(6), visits: 4, status: 'active' },
  { id: 'SMV-1009', name: 'Joseph Mathew', age: 67, sex: 'M', phone: '+91 ••••• ••839', language: 'ml', lastVisit: daysAgo(9), visits: 15, status: 'followUp' },
  { id: 'SMV-1010', name: 'Bhavna Patel', age: 31, sex: 'F', phone: '+91 ••••• ••092', language: 'gu', lastVisit: daysAgo(30), visits: 2, status: 'active' },
  { id: 'SMV-1011', name: 'Bikash Mohanty', age: 49, sex: 'M', phone: '+91 ••••• ••561', language: 'or', lastVisit: daysAgo(45), visits: 6, status: 'active' },
  { id: 'SMV-1012', name: 'Rupa Boro', age: 38, sex: 'F', phone: '+91 ••••• ••274', language: 'brx', lastVisit: daysAgo(2), visits: 1, status: 'needsReview' },
]

/** Items waiting for doctor approval (sidebar badge). */
export const PENDING_APPROVAL_COUNT = 7

export function findPatient(id: string) {
  return SAMPLE_PATIENTS.find((p) => p.id === id)
}

/**
 * Appointment types, as the backend returns them (POST /api/fetch-appointments;
 * backend/app/schemas/appointments.py). The data itself lives in appointments-store.ts.
 */

export const APPOINTMENT_STATUSES = ['scheduled', 'active', 'needsReview', 'followUp', 'closed'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export type Department = 'generalMedicine' | 'cardiology' | 'endocrinology' | 'orthopaedics' | 'pulmonology'

export interface SampleDoctor {
  id: string
  name: string
  department: Department
}

export interface SampleAppointment {
  id: string
  patientId: string // SamplePatient.id
  doctorId: string // SampleDoctor.id
  date: string // ISO date (local)
  start: string // HH:mm, 24-hour
  end: string // HH:mm, 24-hour
  language: string // LANGUAGES code the consultation is held in
  visit: number // the patient's nth visit
  status: AppointmentStatus
  // From the backend (/api/fetch-appointments): the details booked with the appointment.
  patient?: AppointmentPatient
  doctor?: SampleDoctor
  notes?: string | null
  meetingLink?: string | null
  calendarLink?: string | null
}

/** The patient as booked on an appointment (the backend's appointment record). */
export interface AppointmentPatient {
  id: string
  name: string
  age?: number | null
  sex?: 'F' | 'M' | 'O' | null
  phone?: string | null
}

/**
 * SAMPLE DATA — UI prototype only. Replaced by the API in the backend phase.
 * Every appointment belongs to a patient in SAMPLE_PATIENTS; doctor names are fictional.
 */
import { daysAgo } from '@/data/sample'

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

export const SAMPLE_DOCTORS: SampleDoctor[] = [
  { id: 'DOC-01', name: 'Dr. Kavita Menon', department: 'generalMedicine' },
  { id: 'DOC-02', name: 'Dr. Arjun Reddy', department: 'cardiology' },
  { id: 'DOC-03', name: 'Dr. Farah Siddiqui', department: 'endocrinology' },
  { id: 'DOC-04', name: 'Dr. Suresh Iyer', department: 'orthopaedics' },
  { id: 'DOC-05', name: 'Dr. Anand Joshi', department: 'pulmonology' },
]

// daysAgo(-n) is n days from today, so the sample stays current.
export const SAMPLE_APPOINTMENTS: SampleAppointment[] = [
  { id: 'APT-2001', patientId: 'SMV-1001', doctorId: 'DOC-03', date: daysAgo(0), start: '09:00', end: '09:30', language: 'kn', visit: 7, status: 'needsReview' },
  { id: 'APT-2002', patientId: 'SMV-1002', doctorId: 'DOC-02', date: daysAgo(0), start: '09:30', end: '10:00', language: 'te', visit: 12, status: 'active' },
  { id: 'APT-2003', patientId: 'SMV-1004', doctorId: 'DOC-01', date: daysAgo(0), start: '10:00', end: '10:30', language: 'ur', visit: 1, status: 'active' },
  { id: 'APT-2004', patientId: 'SMV-1005', doctorId: 'DOC-01', date: daysAgo(0), start: '10:30', end: '11:00', language: 'hi', visit: 3, status: 'needsReview' },
  { id: 'APT-2005', patientId: 'SMV-1007', doctorId: 'DOC-04', date: daysAgo(0), start: '11:30', end: '12:00', language: 'mr', visit: 10, status: 'scheduled' },
  { id: 'APT-2006', patientId: 'SMV-1009', doctorId: 'DOC-02', date: daysAgo(0), start: '14:00', end: '14:30', language: 'ml', visit: 16, status: 'scheduled' },
  { id: 'APT-2007', patientId: 'SMV-1003', doctorId: 'DOC-03', date: daysAgo(-1), start: '09:00', end: '09:30', language: 'ta', visit: 6, status: 'scheduled' },
  { id: 'APT-2008', patientId: 'SMV-1008', doctorId: 'DOC-01', date: daysAgo(-1), start: '10:00', end: '10:30', language: 'pa', visit: 5, status: 'scheduled' },
  { id: 'APT-2009', patientId: 'SMV-1012', doctorId: 'DOC-05', date: daysAgo(-2), start: '11:00', end: '11:45', language: 'brx', visit: 2, status: 'scheduled' },
  { id: 'APT-2010', patientId: 'SMV-1006', doctorId: 'DOC-01', date: daysAgo(-3), start: '15:00', end: '15:30', language: 'bn', visit: 3, status: 'scheduled' },
  { id: 'APT-2011', patientId: 'SMV-1010', doctorId: 'DOC-03', date: daysAgo(-5), start: '09:30', end: '10:00', language: 'gu', visit: 3, status: 'scheduled' },
  { id: 'APT-2012', patientId: 'SMV-1011', doctorId: 'DOC-05', date: daysAgo(-7), start: '12:00', end: '12:30', language: 'or', visit: 7, status: 'scheduled' },
  { id: 'APT-2013', patientId: 'SMV-1012', doctorId: 'DOC-05', date: daysAgo(2), start: '10:00', end: '10:45', language: 'brx', visit: 1, status: 'needsReview' },
  { id: 'APT-2014', patientId: 'SMV-1007', doctorId: 'DOC-04', date: daysAgo(3), start: '16:00', end: '16:30', language: 'mr', visit: 9, status: 'followUp' },
  { id: 'APT-2015', patientId: 'SMV-1008', doctorId: 'DOC-01', date: daysAgo(6), start: '11:00', end: '11:30', language: 'pa', visit: 4, status: 'closed' },
  { id: 'APT-2016', patientId: 'SMV-1009', doctorId: 'DOC-02', date: daysAgo(9), start: '14:30', end: '15:00', language: 'ml', visit: 15, status: 'followUp' },
  { id: 'APT-2017', patientId: 'SMV-1006', doctorId: 'DOC-01', date: daysAgo(14), start: '09:00', end: '09:30', language: 'bn', visit: 2, status: 'closed' },
  { id: 'APT-2018', patientId: 'SMV-1003', doctorId: 'DOC-03', date: daysAgo(21), start: '10:30', end: '11:00', language: 'ta', visit: 5, status: 'followUp' },
  { id: 'APT-2019', patientId: 'SMV-1010', doctorId: 'DOC-03', date: daysAgo(30), start: '12:00', end: '12:30', language: 'gu', visit: 2, status: 'closed' },
  { id: 'APT-2020', patientId: 'SMV-1011', doctorId: 'DOC-05', date: daysAgo(45), start: '15:30', end: '16:00', language: 'or', visit: 6, status: 'closed' },
]

export function findDoctor(id: string) {
  return SAMPLE_DOCTORS.find((d) => d.id === id)
}

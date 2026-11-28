-- Consultation appointments, mirrored from the doctor's Google Calendar.
-- The backend creates the row first (to claim the APT-#### id), then the
-- calendar event, then stores the event id. /api/fetch-appointments re-syncs
-- rows from the calendar, so the calendar wins for date, time and details.
-- Each doctor sees and edits only their own appointments (RLS below).

-- APT-2001, APT-2002, ... (the frontend's appointment id format).
create sequence public.appointment_number_seq start with 2001;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  appointment_id text not null unique
    default ('APT-' || nextval('public.appointment_number_seq'::regclass)::text)
    check (appointment_id ~ '^APT-[0-9]{4,}$'),
  doctor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Patient details (as on the Consultations page).
  patient_number text not null check (patient_number ~ '^SMV-[0-9]{4,}$'),
  patient_name text not null check (char_length(btrim(patient_name)) between 1 and 80),
  patient_age smallint check (patient_age between 0 and 120),
  patient_sex text check (patient_sex in ('F', 'M', 'O')),
  patient_phone text check (patient_phone ~ '^[6-9][0-9]{9}$'),
  -- Treating doctor (as on the Consultations page; may differ from the signed-in user).
  doctor_code text not null check (doctor_code ~ '^DOC-[0-9]{2,}$'),
  doctor_name text not null check (char_length(btrim(doctor_name)) between 1 and 80),
  department text not null
    check (department in ('generalMedicine', 'cardiology', 'endocrinology', 'orthopaedics', 'pulmonology')),
  -- Slot, in the clinic's time zone (GOOGLE_CALENDAR_TIMEZONE).
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  language text not null check (char_length(language) between 2 and 4),
  visit integer not null default 1 check (visit >= 1),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'active', 'needsReview', 'followUp', 'closed')),
  notes text check (char_length(notes) <= 500),
  calendar_event_id text unique check (char_length(calendar_event_id) <= 1024),
  calendar_link text check (char_length(calendar_link) <= 2048),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_slot_order check (end_time > start_time)
);

comment on table public.appointments is 'Consultation appointments, synced with the doctor''s Google Calendar.';

-- Date-range listing per doctor; also serves the RLS filter.
create index appointments_doctor_date_idx on public.appointments (doctor_id, appointment_date, start_time);

-- public.set_updated_at() comes from the patients migration.
create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;

revoke all on public.appointments from anon;
revoke all on sequence public.appointment_number_seq from anon;
grant select, insert, update, delete on public.appointments to authenticated;
-- Needed for the appointment_id default when a doctor inserts a row.
grant usage on sequence public.appointment_number_seq to authenticated;

create policy "Doctors read their own appointments"
on public.appointments for select to authenticated
using ((select auth.uid()) = doctor_id);

create policy "Doctors add their own appointments"
on public.appointments for insert to authenticated
with check ((select auth.uid()) = doctor_id);

create policy "Doctors update their own appointments"
on public.appointments for update to authenticated
using ((select auth.uid()) = doctor_id)
with check ((select auth.uid()) = doctor_id);

create policy "Doctors delete their own appointments"
on public.appointments for delete to authenticated
using ((select auth.uid()) = doctor_id);

-- Patients registered by a doctor through the New patient form.
-- Each doctor sees and edits only their own patients (RLS below).
-- Only patients who gave recording consent are stored (Critical Rule 3):
-- the app keeps declined patients in memory for the session only.
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_number bigint generated always as identity (start with 1001) unique,
  doctor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 80),
  age smallint not null check (age between 0 and 120),
  sex text not null check (sex in ('F', 'M', 'O')),
  phone text check (phone ~ '^[6-9][0-9]{9}$'),
  language text not null check (char_length(language) between 2 and 4),
  can_read boolean not null default true,
  companion boolean not null default false,
  allergies text check (char_length(allergies) <= 500),
  conditions text[] not null default '{}'
    check (conditions <@ array['diabetes', 'hypertension', 'asthma', 'heart', 'thyroid', 'kidney']),
  medicines text check (char_length(medicines) <= 500),
  consent text not null check (consent = 'given'),
  -- The patient's spoken answers, verbatim, per field (Critical Rule 6).
  patient_words jsonb not null default '{}'::jsonb check (jsonb_typeof(patient_words) = 'object'),
  status text not null default 'active' check (status in ('active', 'followUp', 'needsReview')),
  visits integer not null default 0 check (visits >= 0),
  last_visit date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.patients is 'Patients registered by doctors. Stored only with recording consent.';

-- Doctor's patient list, newest first; also serves the RLS filter.
create index patients_doctor_created_idx on public.patients (doctor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger patients_set_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

alter table public.patients enable row level security;

revoke all on public.patients from anon;
grant select, insert, update, delete on public.patients to authenticated;

create policy "Doctors read their own patients"
on public.patients for select to authenticated
using ((select auth.uid()) = doctor_id);

create policy "Doctors add their own patients"
on public.patients for insert to authenticated
with check ((select auth.uid()) = doctor_id);

create policy "Doctors update their own patients"
on public.patients for update to authenticated
using ((select auth.uid()) = doctor_id)
with check ((select auth.uid()) = doctor_id);

create policy "Doctors delete their own patients"
on public.patients for delete to authenticated
using ((select auth.uid()) = doctor_id);

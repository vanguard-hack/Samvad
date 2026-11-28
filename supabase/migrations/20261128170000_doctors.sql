-- Doctors who take consultations, so appointments are booked with a real doctor
-- (Consultations page: pick a slot, a patient, then an available doctor).
-- Every signed-in user may read the list; only the database owner changes it
-- (edit rows in the Supabase dashboard or a later migration).
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^DOC-[0-9]{2,}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  department text not null
    check (department in ('generalMedicine', 'cardiology', 'endocrinology', 'orthopaedics', 'pulmonology')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.doctors is 'Doctors available for consultations; read-only to the app.';

-- The booking list: active doctors by department.
create index doctors_active_department_idx on public.doctors (department, name) where active;

-- public.set_updated_at() comes from the patients migration.
create trigger doctors_set_updated_at
before update on public.doctors
for each row execute function public.set_updated_at();

alter table public.doctors enable row level security;

revoke all on public.doctors from anon;
grant select on public.doctors to authenticated;

create policy "Signed-in users read doctors"
on public.doctors for select to authenticated
using (true);

-- The clinic's doctors, one per department (rename or add rows as staff change).
insert into public.doctors (code, name, department) values
  ('DOC-01', 'Dr. Kavita Menon', 'generalMedicine'),
  ('DOC-02', 'Dr. Arjun Reddy', 'cardiology'),
  ('DOC-03', 'Dr. Farah Siddiqui', 'endocrinology'),
  ('DOC-04', 'Dr. Suresh Iyer', 'orthopaedics'),
  ('DOC-05', 'Dr. Anand Joshi', 'pulmonology');

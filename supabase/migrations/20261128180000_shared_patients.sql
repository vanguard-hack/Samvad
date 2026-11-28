-- Patients are shared by the whole clinic: every signed-in user can see and
-- book any patient, and update their queue details, whoever registered them.
-- Registering stays tied to the signed-in user (doctor_id = auth.uid()), and
-- only the user who registered a patient can delete them or move them to
-- another user (doctor_id cannot be changed by anyone else).

drop policy "Doctors read their own patients" on public.patients;
drop policy "Doctors update their own patients" on public.patients;

create policy "Signed-in users read all patients"
on public.patients for select to authenticated
using (true);

create policy "Signed-in users update all patients"
on public.patients for update to authenticated
using (true)
with check (true);

-- doctor_id records who registered the patient; it never changes after insert.
create or replace function public.keep_patient_doctor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.doctor_id is distinct from old.doctor_id then
    raise exception 'doctor_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger patients_keep_doctor
before update on public.patients
for each row execute function public.keep_patient_doctor();

-- The clinic-wide list is ordered by registration time.
create index if not exists patients_created_idx on public.patients (created_at desc);

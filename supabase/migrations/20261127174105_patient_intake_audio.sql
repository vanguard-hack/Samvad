-- Voice intake recording: the questions Samvad asked and the patient's spoken
-- answers. Audio files live in the private "patient-audio" bucket under
-- <doctor_id>/<patient_id>/...; this column lists them in order.
-- Written only for patients who gave recording consent (Critical Rule 3).
alter table public.patients
  add column intake_log jsonb not null default '[]'::jsonb
  check (jsonb_typeof(intake_log) = 'array');

comment on column public.patients.intake_log is
  'Ordered voice-intake turns: [{seq, role: samvad|patient, field, text, english, audio_path}]';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-audio', 'patient-audio', false, 5242880, array['audio/wav'])
on conflict (id) do nothing;

-- A doctor may only touch files in their own folder (first path segment = their user id).
create policy "Doctors read their own patient audio"
on storage.objects for select to authenticated
using (bucket_id = 'patient-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Doctors upload their own patient audio"
on storage.objects for insert to authenticated
with check (bucket_id = 'patient-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Doctors delete their own patient audio"
on storage.objects for delete to authenticated
using (bucket_id = 'patient-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

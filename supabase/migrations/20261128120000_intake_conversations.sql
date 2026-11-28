-- Voice patient-intake conversations appear in the Conversations history too.
-- A session is either the doctor's voice assistant ('assistant') or a New
-- patient voice intake ('intake'). Intake sessions belong to the saved patient
-- and are deleted with them. They are written only after the patient is saved
-- with consent (Critical Rule 3: declined consent = nothing stored).
alter table public.assistant_sessions
  add column kind text not null default 'assistant' check (kind in ('assistant', 'intake')),
  add column patient_id uuid references public.patients (id) on delete cascade;

create index assistant_sessions_patient_idx on public.assistant_sessions (patient_id) where patient_id is not null;

-- Patient's words stay verbatim in `text`; `english` is shown beside them
-- (Critical Rule 6). `audio_path` points to the turn's clip in the private
-- patient-audio bucket (played through short-lived signed links).
alter table public.assistant_messages
  add column english text check (char_length(english) <= 4000),
  add column audio_path text check (char_length(audio_path) <= 300);

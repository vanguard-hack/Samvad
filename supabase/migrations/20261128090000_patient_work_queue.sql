-- Work-queue fields for the doctor's prioritized patient queue.
-- Priority is set by the doctor (never by AI); null means "not triaged yet".
-- The older `status` column is kept but no longer used by the app.
alter table public.patients
  add column clinic text check (char_length(btrim(clinic)) between 1 and 80),
  add column reason text check (char_length(btrim(reason)) between 1 and 200),
  add column priority text check (priority in ('high', 'medium', 'low')),
  add column queue_status text not null default 'needs_action'
    check (queue_status in ('needs_action', 'in_progress', 'waiting', 'completed')),
  add column last_event text not null default 'registered'
    check (last_event in ('registered', 'voice_intake', 'triaged', 'status_changed', 'visit')),
  add column last_event_at timestamptz not null default now(),
  add column due_at timestamptz;

update public.patients
set last_event = case when jsonb_array_length(intake_log) > 0 then 'voice_intake' else 'registered' end,
    last_event_at = created_at;

-- The queue view: one doctor's patients by status, soonest due first.
create index patients_doctor_queue_idx on public.patients (doctor_id, queue_status, due_at);

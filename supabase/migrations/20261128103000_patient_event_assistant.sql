-- Allow "assistant" as a last_event so records saved by the voice assistant are marked.
alter table public.patients drop constraint if exists patients_last_event_check;
alter table public.patients add constraint patients_last_event_check
  check (last_event in ('registered', 'voice_intake', 'triaged', 'status_changed', 'visit', 'assistant'));

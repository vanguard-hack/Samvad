-- Voice-assistant conversations: one session per opening of the assistant
-- (Ctrl+Space until it is closed), with every question and reply in order.
-- Each doctor sees only their own conversations.
create table public.assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.assistant_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.assistant_sessions (id) on delete cascade,
  doctor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) between 1 and 4000),
  language text check (char_length(language) between 2 and 4),
  interrupted boolean not null default false,
  created_at timestamptz not null default now()
);

create index assistant_sessions_doctor_started_idx on public.assistant_sessions (doctor_id, started_at desc);
create index assistant_messages_session_idx on public.assistant_messages (session_id, id);
create index assistant_messages_doctor_idx on public.assistant_messages (doctor_id);

alter table public.assistant_sessions enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_sessions, public.assistant_messages from anon;
grant select, insert, update, delete on public.assistant_sessions, public.assistant_messages to authenticated;

create policy "Doctors manage their own assistant sessions"
on public.assistant_sessions for all to authenticated
using ((select auth.uid()) = doctor_id)
with check ((select auth.uid()) = doctor_id);

-- A message must belong to one of the doctor's own sessions.
create policy "Doctors manage their own assistant messages"
on public.assistant_messages for all to authenticated
using ((select auth.uid()) = doctor_id)
with check (
  (select auth.uid()) = doctor_id
  and exists (select 1 from public.assistant_sessions s where s.id = session_id and s.doctor_id = (select auth.uid()))
);

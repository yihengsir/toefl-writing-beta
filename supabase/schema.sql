create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher')),
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  import_index integer unique,
  type text not null check (type in ('academic', 'email')),
  title text not null,
  time_limit_seconds integer not null,
  prompt_payload jsonb not null,
  source_date date,
  source_raw text,
  duplicate_group_id integer,
  duplicate_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  instructions text,
  allow_ai_feedback boolean not null default false,
  status text not null default 'published' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  essay text not null,
  word_count integer not null default 0,
  time_used_seconds integer not null default 0,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_feedbacks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  score numeric,
  summary text not null,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_feedbacks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'deepseek',
  model text not null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  score numeric,
  result_json jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entitlement_type text not null check (entitlement_type in ('ai_feedback', 'question', 'feature')),
  question_id uuid references public.questions(id) on delete cascade,
  feature_key text,
  remaining_uses integer,
  note text,
  created_at timestamptz not null default now(),
  check (
    (entitlement_type = 'ai_feedback' and remaining_uses is not null)
    or (entitlement_type = 'question' and question_id is not null)
    or (entitlement_type = 'feature' and feature_key is not null)
  )
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('ai_feedback', 'question_unlock', 'feature_unlock')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_assignments_student on public.assignments(student_id);
create index if not exists idx_assignments_teacher on public.assignments(teacher_id);
create index if not exists idx_submissions_student on public.submissions(student_id, created_at desc);
create index if not exists idx_submissions_assignment on public.submissions(assignment_id);
create index if not exists idx_entitlements_user on public.entitlements(user_id, entitlement_type);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

drop view if exists public.question_catalog;
create view public.question_catalog as
select
  id,
  import_index,
  type,
  source_date,
  source_raw,
  is_active
from public.questions
where is_active = true;

revoke all on table public.question_catalog from public;
revoke all on table public.question_catalog from anon;
grant select on table public.question_catalog to authenticated;

comment on view public.question_catalog is
  'Safe locked-question catalogue. Excludes title and prompt_payload so locked prompts are never sent to the frontend.';

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'teacher', false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.teacher_feedbacks enable row level security;
alter table public.ai_feedbacks enable row level security;
alter table public.entitlements enable row level security;
alter table public.payment_requests enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles self or teacher read" on public.profiles;
create policy "profiles self or teacher read"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_teacher());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "teachers read all questions" on public.questions;
create policy "teachers read all questions"
on public.questions for select
to authenticated
using (public.is_teacher());

drop policy if exists "authenticated read active question catalogue" on public.questions;
drop policy if exists "students read assigned or unlocked questions" on public.questions;
create policy "students read assigned or unlocked questions"
on public.questions for select
to authenticated
using (
  exists (
    select 1 from public.assignments a
    where a.question_id = questions.id
      and a.student_id = auth.uid()
      and a.status = 'published'
  )
  or exists (
    select 1 from public.entitlements e
    where e.question_id = questions.id
      and e.user_id = auth.uid()
      and e.entitlement_type = 'question'
  )
);

drop policy if exists "teachers insert questions" on public.questions;
create policy "teachers insert questions"
on public.questions for insert
to authenticated
with check (public.is_teacher());

drop policy if exists "teachers manage own assignments" on public.assignments;
create policy "teachers manage own assignments"
on public.assignments for all
to authenticated
using (teacher_id = auth.uid() and public.is_teacher())
with check (teacher_id = auth.uid() and public.is_teacher());

drop policy if exists "students read own assignments" on public.assignments;
create policy "students read own assignments"
on public.assignments for select
to authenticated
using (student_id = auth.uid() and status = 'published');

drop policy if exists "students insert own submissions" on public.submissions;
create policy "students insert own submissions"
on public.submissions for insert
to authenticated
with check (
  student_id = auth.uid()
  and (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and a.student_id = auth.uid()
        and a.question_id = question_id
        and a.status = 'published'
    )
    or (
      assignment_id is null
      and exists (
        select 1 from public.entitlements e
        where e.user_id = auth.uid()
          and e.entitlement_type = 'question'
          and e.question_id = submissions.question_id
      )
    )
  )
);

drop policy if exists "students read own submissions" on public.submissions;
create policy "students read own submissions"
on public.submissions for select
to authenticated
using (student_id = auth.uid());

drop policy if exists "teachers read assigned submissions" on public.submissions;
create policy "teachers read assigned submissions"
on public.submissions for select
to authenticated
using (public.is_teacher());

drop policy if exists "teachers publish feedback" on public.teacher_feedbacks;
create policy "teachers publish feedback"
on public.teacher_feedbacks for insert
to authenticated
with check (teacher_id = auth.uid() and public.is_teacher());

drop policy if exists "teachers read feedback for own assignments" on public.teacher_feedbacks;
create policy "teachers read feedback for own assignments"
on public.teacher_feedbacks for select
to authenticated
using (public.is_teacher());

drop policy if exists "students read published feedback" on public.teacher_feedbacks;
create policy "students read published feedback"
on public.teacher_feedbacks for select
to authenticated
using (
  published
  and exists (
    select 1 from public.submissions s
    where s.id = teacher_feedbacks.submission_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists "students read own ai feedback" on public.ai_feedbacks;
create policy "students read own ai feedback"
on public.ai_feedbacks for select
to authenticated
using (student_id = auth.uid());

drop policy if exists "teachers read ai feedback for own assignments" on public.ai_feedbacks;
create policy "teachers read ai feedback for own assignments"
on public.ai_feedbacks for select
to authenticated
using (
  public.is_teacher()
  and exists (
    select 1 from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = ai_feedbacks.submission_id
      and a.teacher_id = auth.uid()
  )
);

drop policy if exists "students read own entitlements" on public.entitlements;
create policy "students read own entitlements"
on public.entitlements for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "teachers manage entitlements" on public.entitlements;
create policy "teachers manage entitlements"
on public.entitlements for all
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

drop policy if exists "students manage own payment requests" on public.payment_requests;
create policy "students manage own payment requests"
on public.payment_requests for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "teachers manage payment requests" on public.payment_requests;
create policy "teachers manage payment requests"
on public.payment_requests for all
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
on public.notifications for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "teachers create notifications" on public.notifications;
create policy "teachers create notifications"
on public.notifications for insert
to authenticated
with check (public.is_teacher());

-- Run this once after the original schema.sql.
-- It exposes only safe locked-question metadata, and lets students submit
-- practice for individually unlocked questions.

alter table public.submissions
alter column assignment_id drop not null;

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

drop policy if exists "teachers read assigned submissions" on public.submissions;
drop policy if exists "teachers read student submissions" on public.submissions;
create policy "teachers read student submissions"
on public.submissions for select
to authenticated
using (public.is_teacher());

drop policy if exists "teachers publish feedback" on public.teacher_feedbacks;
create policy "teachers publish feedback"
on public.teacher_feedbacks for insert
to authenticated
with check (teacher_id = auth.uid() and public.is_teacher());

drop policy if exists "teachers read feedback for own assignments" on public.teacher_feedbacks;
drop policy if exists "teachers read feedback" on public.teacher_feedbacks;
create policy "teachers read feedback"
on public.teacher_feedbacks for select
to authenticated
using (public.is_teacher());

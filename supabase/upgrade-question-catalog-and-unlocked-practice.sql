-- Run this once after the original schema.sql.
-- It lets authenticated students see the question catalogue as locked items,
-- and lets students submit practice for individually unlocked questions.

alter table public.submissions
alter column assignment_id drop not null;

drop policy if exists "authenticated read active question catalogue" on public.questions;
create policy "authenticated read active question catalogue"
on public.questions for select
to authenticated
using (is_active);

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


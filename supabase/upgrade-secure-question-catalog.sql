-- Run this after any earlier beta question-catalog upgrade.
-- It fixes the locked-question security model:
-- students can see safe metadata in question_catalog, but cannot select
-- title or prompt_payload from public.questions until a question is assigned
-- or individually unlocked.

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

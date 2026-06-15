-- Replace the email below with the teacher account email you created in Supabase Auth.
update public.profiles
set role = 'teacher',
    display_name = 'Teacher'
where email = 'your-email@example.com';

-- Verify the teacher account.
select id, role, display_name, email, created_at
from public.profiles
where email = 'your-email@example.com';


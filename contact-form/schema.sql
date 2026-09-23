-- Paste this into your Supabase project's SQL Editor and run it once.
--
-- It creates the table the form writes to, and a policy that lets the
-- publishable key insert rows and nothing else: it cannot read, change or
-- delete them. You read them in the Table Editor, signed in as yourself.

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  message text not null check (char_length(message) between 1 and 5000)
);

alter table public.enquiries enable row level security;

revoke all on public.enquiries from anon, authenticated;
grant insert on public.enquiries to anon;

create policy "Visitors can send an enquiry"
  on public.enquiries
  for insert
  to anon
  with check (true);

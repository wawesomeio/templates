-- Paste this into your Supabase project's SQL Editor and run it once.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320)
);

create table public.orders (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'EUR',
  placed_at timestamptz not null default now()
);

create index on public.orders (customer_id);

-- Row-level security on and no policy: the publishable key can do nothing here.
-- The Function uses the secret key, which skips row-level security.
alter table public.customers enable row level security;
alter table public.orders enable row level security;

with amelia as (
  insert into public.customers (name, email)
  values ('Amelia Okonkwo', 'amelia@example.com')
  returning id
)
insert into public.orders (customer_id, total_cents, currency)
select id, total_cents, 'EUR' from amelia, (values (4250), (1899)) as t (total_cents);

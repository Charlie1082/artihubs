create table if not exists public.public_intake (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('maker', 'seeker', 'intro', 'general')),
  name text,
  email text not null,
  country text,
  region text,
  field text,
  message text,
  source_path text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'contacted', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists public_intake_created_at_idx on public.public_intake (created_at desc);
create index if not exists public_intake_type_idx on public.public_intake (type);
create index if not exists public_intake_email_idx on public.public_intake (lower(email));

alter table public.public_intake enable row level security;

revoke all on table public.public_intake from anon;
revoke all on table public.public_intake from authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.public_intake to service_role;

create table public.leaders (
  id uuid primary key default gen_random_uuid(),
  legacy_id bigint not null unique,
  name text not null,
  phone text not null default '',
  spec text not null default '',
  status public.leader_status not null default 'Available',
  notes text not null default '',
  availability_mode public.leader_availability_mode not null default 'auto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leaders_status_idx on public.leaders (status);
create index leaders_name_idx on public.leaders (name);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  legacy_id bigint not null unique,
  name text not null,
  icon text not null default '✈️',
  color text not null default 'green',
  description text not null default '',
  airport text not null default '',
  includes text not null default '',
  cost text not null default '',
  currency text not null default 'EGP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_unique unique (name)
);

create index services_name_idx on public.services (name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger leaders_set_updated_at
before update on public.leaders
for each row
execute procedure public.set_updated_at();

create trigger services_set_updated_at
before update on public.services
for each row
execute procedure public.set_updated_at();

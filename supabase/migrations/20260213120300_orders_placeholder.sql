-- Schema placeholder for a future orders sync phase (not used by the static app yet).

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  legacy_id bigint not null unique,
  service_id uuid references public.services (id) on delete restrict,
  service_name_legacy text,
  type_legacy text,
  flight text not null default '',
  flight_type text not null default 'Arrival',
  order_date date not null,
  order_time text not null default '12:00',
  dest text not null default '',
  adults integer not null default 0,
  children integer not null default 0,
  child_ages jsonb not null default '[]'::jsonb,
  nationality_breakdown jsonb not null default '[]'::jsonb,
  nat_summary text not null default '',
  vehicles jsonb not null default '[]'::jsonb,
  driver_summary text not null default '',
  leader_id uuid references public.leaders (id) on delete set null,
  rep text not null default '',
  status public.order_status not null default 'Scheduled',
  ref text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index orders_ref_unique_nonempty on public.orders (ref) where ref <> '';

create index orders_order_date_idx on public.orders (order_date);

create index orders_leader_id_idx on public.orders (leader_id);

create index orders_status_idx on public.orders (status);

create index orders_service_id_idx on public.orders (service_id);

create trigger orders_set_updated_at
before update on public.orders
for each row
execute procedure public.set_updated_at();

create table public.order_expenses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  legacy_line_id bigint,
  category text not null default 'Other',
  amount numeric(14, 2) not null default 0,
  expense_date date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (order_id, legacy_line_id)
);

create index order_expenses_order_id_idx on public.order_expenses (order_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner public.attachment_owner not null,
  order_id uuid not null references public.orders (id) on delete cascade,
  expense_id uuid references public.order_expenses (id) on delete cascade,
  filename text not null,
  mime text not null default '',
  size_bytes bigint not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint attachments_expense_fk_ok check (
    (owner = 'order'::public.attachment_owner and expense_id is null)
    or (owner = 'expense'::public.attachment_owner and expense_id is not null)
  )
);

create index attachments_order_id_idx on public.attachments (order_id);

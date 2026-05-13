-- Row level security (Phase A schema). App still reads orders from localStorage when DATA_SOURCE=local|remote.

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role = 'admin'::public.app_role
  );
$$;

create or replace function public.is_active_supervisor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role in ('admin'::public.app_role, 'supervisor'::public.app_role)
  );
$$;

-- ─── profiles ───
alter table public.profiles enable row level security;

create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (auth.uid() = user_id or public.is_active_admin());

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy profiles_no_client_insert
on public.profiles
for insert
to authenticated
with check (false);

-- ─── leaders ───
alter table public.leaders enable row level security;

create policy leaders_select_authenticated
on public.leaders
for select
to authenticated
using (true);

create policy leaders_insert_staff
on public.leaders
for insert
to authenticated
with check (public.is_active_supervisor_or_admin());

create policy leaders_update_staff
on public.leaders
for update
to authenticated
using (public.is_active_supervisor_or_admin())
with check (public.is_active_supervisor_or_admin());

create policy leaders_delete_staff
on public.leaders
for delete
to authenticated
using (public.is_active_supervisor_or_admin());

-- ─── services ───
alter table public.services enable row level security;

create policy services_select_authenticated
on public.services
for select
to authenticated
using (true);

create policy services_insert_staff
on public.services
for insert
to authenticated
with check (public.is_active_supervisor_or_admin());

create policy services_update_staff
on public.services
for update
to authenticated
using (public.is_active_supervisor_or_admin())
with check (public.is_active_supervisor_or_admin());

create policy services_delete_staff
on public.services
for delete
to authenticated
using (public.is_active_supervisor_or_admin());

-- ─── orders (remote phase; not used by static UI yet) ───
alter table public.orders enable row level security;

create policy orders_select_scope
on public.orders
for select
to authenticated
using (
  public.is_active_supervisor_or_admin()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = public.orders.leader_id
  )
);

create policy orders_insert_staff
on public.orders
for insert
to authenticated
with check (public.is_active_supervisor_or_admin());

create policy orders_update_staff
on public.orders
for update
to authenticated
using (public.is_active_supervisor_or_admin())
with check (public.is_active_supervisor_or_admin());

create policy orders_delete_staff
on public.orders
for delete
to authenticated
using (public.is_active_supervisor_or_admin());

-- ─── order_expenses ───
alter table public.order_expenses enable row level security;

create policy order_expenses_select_scope
on public.order_expenses
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.order_expenses.order_id
      and (
        public.is_active_supervisor_or_admin()
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.active = true
            and p.role = 'leader'::public.app_role
            and p.leader_id is not null
            and p.leader_id = o.leader_id
        )
      )
  )
);

create policy order_expenses_write_staff
on public.order_expenses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id = public.order_expenses.order_id
      and public.is_active_supervisor_or_admin()
  )
);

create policy order_expenses_update_staff
on public.order_expenses
for update
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.order_expenses.order_id
      and public.is_active_supervisor_or_admin()
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.id = public.order_expenses.order_id
      and public.is_active_supervisor_or_admin()
  )
);

create policy order_expenses_delete_staff
on public.order_expenses
for delete
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.order_expenses.order_id
      and public.is_active_supervisor_or_admin()
  )
);

-- ─── attachments ───
alter table public.attachments enable row level security;

create policy attachments_select_scope
on public.attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.attachments.order_id
      and (
        public.is_active_supervisor_or_admin()
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.active = true
            and p.role = 'leader'::public.app_role
            and p.leader_id is not null
            and p.leader_id = o.leader_id
        )
      )
  )
);

create policy attachments_write_staff
on public.attachments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id = public.attachments.order_id
      and public.is_active_supervisor_or_admin()
  )
);

create policy attachments_update_staff
on public.attachments
for update
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.attachments.order_id
      and public.is_active_supervisor_or_admin()
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.id = public.attachments.order_id
      and public.is_active_supervisor_or_admin()
  )
);

create policy attachments_delete_staff
on public.attachments
for delete
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = public.attachments.order_id
      and public.is_active_supervisor_or_admin()
  )
);

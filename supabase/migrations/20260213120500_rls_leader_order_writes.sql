-- Allow tour leaders to update their own assigned orders (UI sync from leader devices).

create policy orders_update_leader_own
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = public.orders.leader_id
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = public.orders.leader_id
  )
);

-- Expense lines: leaders may manage expenses on orders assigned to them.

create policy order_expenses_insert_leader_own
on public.order_expenses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    join public.profiles p on p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = o.leader_id
    where o.id = public.order_expenses.order_id
  )
);

create policy order_expenses_update_leader_own
on public.order_expenses
for update
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.profiles p on p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = o.leader_id
    where o.id = public.order_expenses.order_id
  )
)
with check (
  exists (
    select 1
    from public.orders o
    join public.profiles p on p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = o.leader_id
    where o.id = public.order_expenses.order_id
  )
);

create policy order_expenses_delete_leader_own
on public.order_expenses
for delete
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.profiles p on p.user_id = auth.uid()
      and p.active = true
      and p.role = 'leader'::public.app_role
      and p.leader_id is not null
      and p.leader_id = o.leader_id
    where o.id = public.order_expenses.order_id
  )
);

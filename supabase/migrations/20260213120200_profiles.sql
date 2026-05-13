create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  legacy_user_id bigint unique,
  username text not null,
  display_name text not null,
  role public.app_role not null default 'leader',
  leader_id uuid references public.leaders (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_lower_uidx on public.profiles ((lower(username)));

create index profiles_leader_id_idx on public.profiles (leader_id) where leader_id is not null;

create index profiles_role_active_idx on public.profiles (role, active);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display text;
  v_role public.app_role;
begin
  v_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(new.email, '@', 1), '')
  );
  if v_username is null or v_username = '' then
    v_username := 'user_' || replace(new.id::text, '-', '');
  end if;
  v_display := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  begin
    v_role := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'role'), '')::public.app_role,
      'leader'::public.app_role
    );
  exception
    when others then
      v_role := 'leader'::public.app_role;
  end;
  insert into public.profiles (user_id, username, display_name, role, active)
  values (new.id, v_username, v_display, v_role, true);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

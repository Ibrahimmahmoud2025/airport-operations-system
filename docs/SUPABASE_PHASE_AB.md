# Supabase — Phase A & B (schema + remote auth)

Phase A adds Postgres schema and RLS. Phase B wires **sign-in / session** to **Supabase Auth** when `DATA_SOURCE=remote` and Supabase env vars are present. **Orders, leaders, and services still load from `localStorage`** (`airportOpsV2`) until a later phase.

## 1. Create a Supabase project

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) and create a project (pick region, set a database password).
2. Wait until the project finishes provisioning.

## 2. Run SQL migrations

Either use the **SQL Editor** (paste each file in order) or the Supabase CLI (`supabase db push`).

Run these files **in order** from `supabase/migrations/`:

1. `20260213120000_extensions_and_enums.sql`
2. `20260213120100_leaders_and_services.sql`
3. `20260213120200_profiles.sql`
4. `20260213120300_orders_placeholder.sql`
5. `20260213120400_row_level_security.sql`

If a statement fails (for example trigger syntax), check your Postgres version in **Project Settings → Database** and adjust trigger clauses per Supabase docs.

## 3. Auth provider

1. Go to **Authentication → Providers**.
2. Ensure **Email** is enabled (password sign-in).

## 4. Create users (email must match the app)

The browser app signs in with:

`email = <normalized_username> + AUTH_EMAIL_SUFFIX`

Default suffix: `@users.logistics.local` (configurable via `NEXT_PUBLIC_LOGISTICS_AUTH_EMAIL_SUFFIX`).

Examples:

| App username (Users screen) | Email in Supabase        |
|----------------------------|--------------------------|
| `admin`                    | `admin@users.logistics.local` |

1. Go to **Authentication → Users → Add user**.
2. Set **email** to the value above, set **password**, confirm auto-sign-in options as you prefer.
3. After the user is created, the trigger `handle_new_user` inserts a row into **`public.profiles`**.

### Align profile with your app

- Open **Table Editor → profiles** (or SQL) and ensure **`username`** matches the normalized username in the app’s **Users** list (same string users type at sign-in).
- Set **`role`** to `admin`, `supervisor`, or `leader` if it differs from what you passed in user metadata.
- For **tour leaders**, link **`leader_id`** to the UUID in **`public.leaders`** when you have migrated leaders to Postgres; until then the app still uses **integer `leaderId` from local `db.users`**, so local Users must match **username** and leader linkage.

Optional: when inviting users, set **raw user metadata** keys `username`, `display_name`, and `role` so the trigger seeds `profiles` correctly.

## 5. Local app data requirement (Phase B)

Remote sign-in **still requires** a matching row in **Users** in `localStorage` (same normalized username) so `id` / `leaderId` stay compatible with existing orders. If there is no match, sign-in shows an error (by design).

## 6. Feature flag: `DATA_SOURCE`

| Source | Effect |
|--------|--------|
| `window.LOGISTICS_RUNTIME.DATA_SOURCE` from `public-config.js` (built on Vercel) | `local` = password hash in app DB only. `remote` = Supabase Auth when URL + anon key exist. |
| `localStorage.LOGISTICS_DATA_SOURCE` = `local` or `remote` | Overrides runtime for that browser (testing). |

## 7. Environment variables (local + Vercel)

See `.env.example`. Vercel **Project → Settings → Environment Variables**:

| Variable | Required when `DATA_SOURCE=remote` | Description |
|----------|-------------------------------------|-------------|
| `DATA_SOURCE` | Yes | `local` or `remote`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes for remote | Project URL (**Settings → API**). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes for remote | `anon` `public` key (**Settings → API**). |
| `NEXT_PUBLIC_LOGISTICS_AUTH_EMAIL_SUFFIX` | No | Default `@users.logistics.local`; must match emails you create in Supabase. |

Build step (`npm run build`) writes `public-config.js` from these variables.

## 8. Testing checklist

1. **Local default:** do not set remote envs; sign in with existing local users — unchanged.
2. **Remote without keys:** set `DATA_SOURCE=remote` but omit Supabase keys — app shows configuration error on sign-in; set `localStorage.LOGISTICS_DATA_SOURCE='local'` to recover in that tab.
3. **Remote:** create Supabase user + profile row; ensure same username under **Users** in the app; sign in with Supabase password — data still from `localStorage`.
4. **Logout:** clears Supabase session and `logisticsRemoteAuth` session flag.

## 9. Security notes

- The `anon` key is public; RLS protects tables. Never expose the **service role** key in the frontend.
- `public-config.js` is generated at build time and contains the anon key (expected for Supabase client apps).

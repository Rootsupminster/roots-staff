# Roots Rota – staff app

The Roots staff rota as a home-screen web app. Staff log in with their name and 4-digit clock-in PIN and see their shifts and the full rota.

- Rota data lives in Supabase (`rota_` tables) and is only reachable through the PIN login. No pay information is stored or shown.
- The rota is copied in from the manager's rota page automatically three times a day.
- Hosted on GitHub Pages from the `main` branch.

## Manager app (`/manage/`)

Rota, timesheets, clock-in screen and staff details for managers. Sign in with a table-bookings login that has the `manager` role in `public.staff`.
Saving the rota updates the staff app straight away. `supabase.js` is the unmodified browser build of @supabase/supabase-js 2.119.0 (MIT, see `supabase-LICENSE`).

## Checks app (`/checks/`)

Daily, weekly and monthly checks, temperature logs and compliance documents (replaces Leafe).

- Staff sign in with the same name + 4-digit PIN as the rota app. Managers sign in with their bookings login (`manager` role in `public.staff`).
- Data lives in the `chk_` tables. Staff reach them only through `chk_boot`, `chk_submit` and `chk_reading`, which check the PIN session. Managers read and edit them directly, protected by row-level security.
- Certificates and reports are stored in the private `roots-docs` storage bucket. Only managers can read or upload.

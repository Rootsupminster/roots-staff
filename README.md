# Roots Rota – staff app

The Roots staff rota as a home-screen web app. Staff log in with their name and 4-digit clock-in PIN and see their shifts and the full rota.

- Rota data lives in Supabase (`rota_` tables) and is only reachable through the PIN login. No pay information is stored or shown.
- The rota is copied in from the manager's rota page automatically three times a day.
- Hosted on GitHub Pages from the `main` branch.

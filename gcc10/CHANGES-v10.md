# v10 changes
New
- planner.js (+ tests) and plan-ui.jsx: Do now, Today list, This week / This month / Until exam, target-date verdict with options (study more, skip a subject, move the date), measured lecture pace, daily cap, rest day.
- Settings -> Planner card; synced key `plan`; schemaVersion 10.
- scripts/build-single.js and `npm run build:html`: single-file HTML (also a CI artifact).
Replaced on Today: Revisions due, Behind schedule, Neglected subjects, Focus now (their logic now feeds the lists above; revisions get a Done button in Today).
Removed: Best hours card and best-weekday stat, readiness decay, Smart calculator and Time per mark, backup.yml, study_sessions table and hour views (supabase-hardening.sql trimmed; supabase-v10-cleanup.sql drops them from an existing project).
Kept on request: Delete account, privacy link, old migrations, rule1Min/rule2Target fields. Streak counter kept.
Changed: keepalive.yml is kept and fixed. It now calls a `ping()` database function (the old version read the `state` table, which hardening blocks, so it would have failed with HTTP 401).
Fixed: privacy link now points at the GATE-CC repo.
Not changed: Windows installer "cannot be closed" behaviour (unverified, needs a run on Windows); installer and APK are built by GitHub Actions, not in this package.

## v10.1 — UI split

New files
- `index-win.html` — Windows/Electron shell: sidebar nav, twin-column layout, keyboard-friendly, Ctrl+M widget↔desktop toggle
- `index-mobile.html` — Phone PWA shell: bottom nav, large touch targets, hero stats, float timer pill, PYQ big-tap counter
- `web/manifest-mobile.webmanifest` — PWA manifest pointing at index-mobile.html

Changed
- `main.js` — Electron now loads `index-win.html`
- `App.jsx` — detects `body.dataset.platform` ('win'|'mobile'|'web'); exposes `window.__gccSetTab` for shell nav buttons; hides built-in nav/MiniBar on win and mobile; renders Settings inline as a tab on win/mobile
- Original `index.html` kept as-is for the web/PWA desktop fallback

Install as mobile PWA: open `index-mobile.html` in Chrome on Android → Add to Home Screen

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

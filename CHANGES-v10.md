# v10.2 changes

## v10.3

The confirmed UI is `docs/gcc-working-preview.html`; it replaces `docs/gcc-preview.html`.

- Windows is a portrait side panel (default 440 x 780, minimum 360 x 560): title bar with an always-on-top pin (also Ctrl+T, remembered between runs), five-tab strip along the top (Today, Plan, Subjects, Tests, Settings), no sidebar.
- Android/phone shell has the same five tabs on a bottom bar (Plan added; Syllabus renamed Subjects). `npm run android` now builds the phone shell as the APK's start page (before, the APK opened the web shell).
- Today: timer, then Do now + checklist, then the verdict. The planner calculator and the deadline card moved to Plan on every platform; Plan no longer stacks under Today.
- Web fallback nav: Today, Plan, Subjects, Tests (+ settings gear).
- Sync: new `twodevice.test.mjs` runs the real merge code for extension file -> Windows import -> server -> phone and back (ticks, pw state + duration, tests, results, error tags, no duplicates, manual ticks survive a re-sync). New fixture `fixtures/pw-sync-sample.json`.
- Not run here: `npm run dist`, the exe, the APK, live Supabase, live PW.


New
- PW sync import: `applyPwSync` in io.js (+ pwsync.test.mjs). Reads the `pw-sync` v3 JSON from the Chrome extension. Only adds ticks, never removes; stores `pw` state and `dur` on lectures; matches or adds tests; upserts PW results into mocks without touching your concept/calc/time/silly tags. Small `pwSync` summary is synced (phone sees it).
- Windows auto-import: main.js watches Downloads\GCC\pw-sync-latest.json (2 s poll, 1.5 s debounce), IPC `pw:snapshot` / `pw:latest`, preload `pwLatest` / `onPwSnapshot`. Applied silently with a toast when newer. Settings keeps an Import file fallback with a preview.
- Today: timer, verdict (needed / last 7 days / goal h per day), Planner calculator (speed, hours per day, window; remaining hours from real data), Today list, deadline card. The planner only closes the gap: "skip a subject" and "move the date" options removed.
- Edit layout (Settings): hide cards with the cross, restore from "Hidden cards". Verdict and Today list cannot be hidden. Device-local `layout.hidden`; hiding is display-only. layout.js (+ layout.test.mjs).
- Syllabus: chapter header shows done/total, partial, DPP, live and hours left; partial tag on lectures. syllabus-stats.js (+ test).
- Tests: All tests list with kind filters (weekly, TWT, SWT, MST, GBG, PYQ, mock) and status filters (attempted, missed, upcoming); lost-marks tags on every result in History. tests-view.js (+ test).
- Plan: daily rules card (Aptitude, Maths, Core minutes, PYQ goal) with all values editable.
- docs/gcc-preview.html: design reference.

Changed
- PW sync test matching: besides exact name, matches abbreviations (COA, DBMS), leading zeros (SWT 05 = SWT 5) and numbered exams (MST n), so real data updates 88 tests and adds 7 instead of duplicating 20.
- Windows/mobile shells: missing class definitions added; built-in bottom tabs hidden on Windows; emoji nav icons replaced with inline SVG line icons.
- package.json: version 10.2.0; build.files includes index-win.html, index-mobile.html, icon.ico and web/.

Removed
- Readiness card, tab and readiness-core.js (mastery logic lives in planner.js). Old recorder importer replaced by the pw-sync importer.

Not changed / not verified
- Installer "cannot be closed" behaviour (window close hides to tray). Untested idea: end the process from the installer, or quit instead of hide.
- `npm run build` and `npm run dist` were not run in the authoring environment (no network for esbuild/electron-builder). Nothing here has been run on real PW or Windows. `npm test` passes.

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

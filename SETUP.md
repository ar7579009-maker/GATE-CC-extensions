# GATE Command Center v10: setup

One React codebase, four outputs: **Windows EXE**, **Android APK**, **PWA**, **single-file HTML**. Push this folder to GitHub; Actions builds all four.

## Local commands
    npm install
    npm test            # sync merge, timer engine, readiness, planner
    npm start           # desktop (Electron)
    npm run dist        # Windows installer + portable (dist/)
    npm run build:web   # PWA folder www/
    npm run build:html  # one file: dist-html/GATE-Command-Center.html
    npm run android     # www/ -> Android project (run `npx cap add android` once first)

## 1. Supabase (email-code sign-in, no passwords)
1. SQL Editor: run `supabase-setup.sql`, then `supabase-hardening.sql`.
   Already ran the v9 hardening file? Run `supabase-v10-cleanup.sql` once instead (drops the unused sessions table and hour views, adds `ping()`).
2. Authentication -> Providers -> Email: **Enable sign ups ON**, **Confirm email OFF**, OTP length 6, expiry 3600 s.
3. Authentication -> Emails -> SMTP Settings: add custom SMTP (Gmail app password: host `smtp.gmail.com`, port 465). Template editing stays locked until you do.
4. Authentication -> Emails -> Templates -> **Magic Link** and **Confirm signup**: body `Your code: {{ .Token }}` (the app asks for the 6-digit code, not a link).
5. Authentication -> URL Configuration: Site URL `https://<user>.github.io/<repo>/`.
6. Keepalive: workflow **Keep Supabase awake** calls `ping()` every 3 days so the free project never pauses after 7 idle days. After pushing, run it once (Actions -> Run workflow) and check for a green tick. The weekly backup workflow is gone; the app exports and auto-backs up locally.

## 2. Planner (Today tab)
Do now, Today, This week / This month / Until exam, and a verdict for your syllabus target date. Tune it in Settings -> Planner (hours per lecture, revision %, buffer, longest study day, rest day). Skipped subjects are stored in the synced `plan` key. After 5 finished lectures in a subject the planner uses your measured hours per lecture instead of the default.

## 3. Windows EXE
Workflow **Build apps** -> artifact `GATE-Command-Center-windows` (installer and portable). Locally: `npm run dist`. Quit the app from the tray before running a new installer.
- Draggable title strip, single instance, close-to-tray (Settings), Ctrl+M widget/desktop size, Ctrl+T always on top.

## 4. Android APK
Workflow **Build apps** -> artifact `GATE-Command-Center-android`.
- Fixed signing key (once, so updates install over the old app): create `debug.keystore` with `keytool -genkey -v -keystore debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`, base64 it, save as repo secret `ANDROID_DEBUG_KEYSTORE_BASE64`. Never commit the keystore.
- On first launch allow notifications and "Alarms & reminders".

## 5. PWA (GitHub Pages)
Repo -> Settings -> Pages -> Source: **GitHub Actions**. Every push to `main` runs **Deploy web app** and publishes to `https://<user>.github.io/<repo>/`. Open once online, then Install / Add to Home Screen. After a deploy, open the app twice so the new cache takes over.

## 6. Single-file HTML
Workflow **Build apps** -> artifact `GATE-Command-Center-html`, or `npm run build:html`. Open the file in a browser. Data stays in that browser (localStorage); use Export / Import to move it, or sign in to sync. No offline caching or install prompt (that is the PWA's job).

## Data
Same storage key and synced keys as v9, plus one new synced key `plan`. v9 and v10 devices can sync with each other during the upgrade. Saves keep a rolling backup (`gcc2027_v1:bak`) and a copy of any corrupt save. Update every device to v10, then sign in first on the device with the most data.

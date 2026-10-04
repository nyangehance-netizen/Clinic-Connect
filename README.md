# Clinic Connect

Patients find hospitals and polyclinics, request treatment (at the facility, a home visit, or a video call), and follow up by message. Facility staff confirm a time, suggest another one, or decline, and patients get SMS updates and reminders.

It is built to be easy to host. There are no outside packages to install. It needs only Node.js 22.13 or newer and uses Node's built-in SQLite database.

## What's included

| Part | Where | What it does |
|---|---|---|
| Patient app | `public/` | Find care, facility profiles, request form, "My requests" with live status and messages |
| Clinic desk | `public/` | Request list with counts, booking (date, time, doctor), suggest new time, decline, complete, messaging |
| Facility profile | `public/` | Staff edit services, prices, doctors, hours and options |
| Admin | `public/` | Verify facilities before patients see them, create and remove staff accounts |
| API | `src/app.js` | REST API with sign-in, roles, validation, audit log |
| Database | `src/db.js` | SQLite tables, created automatically on first start |
| SMS | `src/sms.js` | Africa's Talking, or printed to the log in development |
| Reminders | `src/server.js` | Checks every minute and texts patients before their appointment |
| Tests | `test/` | End-to-end API tests, including privacy checks |

## Run it on your computer

```bash
cp .env.example .env              # then edit .env (see below)
npm run seed-demo                 # optional: two example facilities
npm run create-admin -- "Your Name" 0712345678 "a-long-admin-password"
npm start                         # open http://localhost:3000
```

Sign in with the admin phone and password. Then open **Admin** to:
1. Add your first facility, or edit an example one.
2. Click **Verify** so patients can see it.
3. Create a staff account for the facility's reception. Staff sign in and land on the **Clinic desk**.

Patients sign up themselves from **Sign in → Create an account**.

Run the tests with `npm test`.

## Install it on your phone

Clinic Connect is an installable web app (a PWA). Once it's online at an `https://` address:

- **Android (Chrome):** open the address. Tap **Install app** on the banner, or use the ⋮ menu → **Install app**.
- **iPhone (Safari):** open the address, tap **Share**, then **Add to Home Screen**.

It gets its own icon and opens full screen like a normal app. Phones only allow this from an HTTPS address, not from `localhost` on your computer.

### Quickest free preview (about 10 minutes, no server needed)

1. Put this folder in a GitHub repository (github.com → New repository → upload the files).
2. Sign up at render.com, choose **New → Blueprint**, and pick the repository. `render.yaml` sets everything up and adds two example facilities.
3. When it shows **Live**, open the `https://clinic-connect-….onrender.com` address on your phone and install it.
4. To get the admin and staff screens, open the service's **Shell** tab in Render and run:
   `node --disable-warning=ExperimentalWarning scripts/create-admin.js "Your Name" 0712345678 "a-long-admin-password"`

The free plan sleeps after a period with no visits, so the first visit afterward takes about a minute. It also erases the database on every restart. Use it for previews. For real patients, use the paid setup below or a plan with a persistent disk.

## Put it online

Any host that runs Node.js 22 works. Docker is the easiest option:

```bash
docker build -t clinic-connect .
docker run -d --name clinic-connect -p 3000:3000 \
  --env-file .env -v clinic-data:/app/data clinic-connect
docker exec clinic-connect node --disable-warning=ExperimentalWarning scripts/create-admin.js "Your Name" 0712345678 "a-long-admin-password"
```

Then put it behind HTTPS. Caddy or Nginx with a free Let's Encrypt certificate works well, as do platforms like Render, Railway or Fly.io that handle HTTPS for you. Set `TRUST_PROXY=true` when a proxy sits in front.

**Before real patients use it:**
- Set a long random `AUTH_SECRET`. The app refuses to start in production without one.
- Serve it only over HTTPS. Patient notes are health data.
- Back up the database file (`data/clinic-connect.db`) every day and keep copies off the server.
- Check your obligations under your country's data protection law. In Tanzania that is the Personal Data Protection Act, 2022, which may require registering with the Personal Data Protection Commission. Have a privacy notice ready for patients.

## Turn on real SMS (Africa's Talking)

1. Create an account at africastalking.com and an app. Test in the sandbox first.
2. In `.env` set `SMS_PROVIDER=africastalking`, `AT_USERNAME`, and `AT_API_KEY`. For the sandbox, also set `AT_SANDBOX=true` with username `sandbox`.
3. Optional: request a sender ID such as `CLINIC` and set `AT_SENDER_ID`.

Every SMS attempt is recorded in the `sms_log` table, so failures can be checked. Confirm the request format against Africa's Talking's current documentation before going live. To use a different provider, change `deliver()` in `src/sms.js`.

## Who can see what

| | Patient | Staff | Admin |
|---|---|---|---|
| Verified facilities | Yes | Yes | All, including unverified |
| A patient's requests and notes | Only their own | Only for their own facility | All |
| Clinic desk | – | Their facility | Any facility |
| Edit facility profile | – | Their facility | Any |
| Verify facilities, manage staff | – | – | Yes |

Each time staff open a patient's request it is written to `audit_log`, along with every sign-in and change. The desk list shows only names and services. Notes and phone numbers appear only when a request is opened.

## API summary

All endpoints are under `/api`. Signed-in calls send `Authorization: Bearer <token>`.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Anyone |
| GET | `/me` | Signed in |
| GET | `/facilities`, `/facilities/:id` | Anyone |
| POST | `/facilities` · `/facilities/:id/verify` · DELETE `/facilities/:id` | Admin |
| PUT | `/facilities/:id` | Admin, or staff of that facility |
| GET/POST/DELETE | `/staff`, `/staff/:id` | Admin |
| POST | `/requests` · GET `/requests/mine` | Patient |
| GET | `/desk/requests?status=open\|confirmed\|closed\|all` | Staff, admin (`&facility=`) |
| GET | `/requests/:id` | The patient, or that facility's staff |
| POST | `/requests/:id/action` `{action: confirm\|propose\|decline\|complete\|accept\|cancel}` | Clinic or patient as fits |
| POST | `/requests/:id/messages` `{body}` | The patient, or that facility's staff |

## Growing it later

- **More traffic:** SQLite handles a city-scale pilot comfortably on one server. To run several servers, move to PostgreSQL. All database calls are in `src/app.js` and `src/db.js`.
- **Mobile money payments:** add M-Pesa, Tigo Pesa or Airtel Money checkout when a request is confirmed.
- **USSD access** for feature phones, through the same Africa's Talking account.
- **Swahili interface:** the user-facing text is in `public/app.js`, so it can be translated in one place.
- **Password reset by SMS code.**

## Android app (APK)

Every push to `main` builds an Android APK on GitHub automatically (`.github/workflows/android-apk.yml`), in one of two modes:

- **Preview mode** (no `APP_URL` set): the whole app is inside the APK and keeps its data on the phone. It works with no hosting. To try the clinic side, sign in with the demo accounts shown on the sign-in screen (admin `0700000001` / `admin123`, clinic staff `0700000002` / `staff123`). Use it for demos only.
- **Live mode** (`APP_URL` set): the APK opens your hosted server, so everyone shares the same data, and web updates reach phones without a new APK.

To switch to live mode:

1. Host the web app first (see "Quickest free preview" above) and copy its `https://` address.
2. On GitHub, open **Settings → Secrets and variables → Actions → Variables** and add `APP_URL` with that address.
3. Open **Actions → Build Android APK → Run workflow**.
4. When it finishes, open **Releases** on your phone, download `clinic-connect.apk`, allow your browser to install unknown apps, and tap **Install**.

This is a debug build for previews and testing. Publishing on Google Play needs a signed release build and a Play Console account.

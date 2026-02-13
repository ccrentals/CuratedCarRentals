# Curated Car Rentals

Next.js (App Router) + TypeScript + Tailwind, deployed on Netlify with a Neon Postgres database.

## Local development

```bash
npm install
npm run dev
```

App: `http://localhost:3000`

## Core URLs

Public:
- `/` Home
- `/fleet` Fleet
- `/book` Booking form

Admin:
- `/admin/login` Admin sign-in
- `/admin` Dashboard
- `/admin/health` Health/readiness snapshot (recommended for go-live checks)

Health JSON:
- `/api/health/db` DB connectivity check
- `/api/health/ready` Full readiness snapshot used by `/admin/health`

## Environment variables

Use `.env.example` as the full reference.

Important:
- `ADMIN_SESSION_SECRET` is required (sessions).
- `CSRF_SECRET` is required in production (CSRF protection). In development, a fallback secret is used and shown on `/admin/health`.
- `SITE_URL` must be a valid `http(s)` URL.

## Database (Neon)

Schema file: `db/schema.sql`

Notes:
- The admin lockout feature uses `users.locked_at` and `admin_login_attempts`.
- Vehicles store image URLs in `vehicles.image_urls_json` (files are not stored in Neon).

### Migrations

We use versioned SQL migrations in `migrations/` and track applied migrations in the `schema_migrations` table.

Apply migrations locally (or against Neon) with:

```bash
npm run migrate
```

This applies pending files in filename order (e.g. `001_...sql`, `002_...sql`) and is safe to re-run.

### Public fleet vehicle import (one-time)

The public Fleet/Home pages now read from Admin vehicles in Neon.
To import the legacy frontend vehicles (`src/data/vehicles.ts`) into Admin as published records:

```bash
npm run seed:public-vehicles
```

The import is idempotent (safe to re-run). It updates existing rows by `features_json.legacy_id` and inserts missing ones.

## Admin users

The app expects bcrypt password hashes.

Generate a bcrypt hash locally:

```bash
node -e "require('bcryptjs').hash('YOUR_PASSWORD_HERE', 12).then(console.log)"
```

Then insert into Neon:

```sql
insert into users (email, password_hash, role)
values ('admin@curatedcarrentals.com', '<PASTE_BCRYPT_HASH>', 'ADMIN');
```

## Money fields

`*_cents` columns currently store **JMD dollars as integers** (naming legacy).
Example: `3000` is treated as **JMD 3,000.00**.

## Postgres SSL mode

To keep current secure behavior (and avoid pg warnings), set `sslmode=verify-full` on `DATABASE_URL`.

If you explicitly want libpq-compatible semantics now, set:
- `uselibpqcompat=true&sslmode=require`

The app also normalizes `sslmode=require|prefer|verify-ca` to `verify-full` unless `uselibpqcompat=true` is set.

## Payments (WiPay)

Deposit payments:
- Start: `POST /api/payments/wipay/start`
- Return: `GET /api/payments/wipay/return`
- Webhook: `POST /api/payments/wipay/webhook`

WiPay env vars (see `.env.example`):
- `WIPAY_ACCOUNT_NUMBER` (digits only)
- `WIPAY_API_KEY`
- `WIPAY_ENV` (`sandbox` or `live`)
- `WIPAY_FEE_STRUCTURE` (`merchant_absorb`)
- `WIPAY_ORIGIN` (slug, letters/numbers/dash/underscore)

## Emails (Resend)

Email sending uses Resend:
- `RESEND_API_KEY`
- `RESEND_FROM` (test senders allowed during development)

## Invoices (PDFMonkey)

Invoice PDFs are generated via PDFMonkey (and attached to emails when available):
- `PDFMONKEY_API_KEY`
- `PDFMONKEY_TEMPLATE_ID`

If PDFMonkey hits quota or is misconfigured, the UI and emails should degrade gracefully (health page will show status).

## Cron reminders

Reminders are exposed as routes and can be run from the admin UI:
- `/admin/cron`

Required:
- `CRON_SECRET`

Routes:
- `POST /api/cron/pickup-reminders`
- `POST /api/cron/balance-reminders`
- `POST /api/cron/note-emails`

Admin-only test/simulation route (no external email send):
- `POST /api/admin/cron/simulate-reminders`

Observability:
- `Last Runs` on `/admin/cron` is driven by durable run records in `audit_logs` (`entity_type=cron_run`, `action=CRON_REMINDER_RUN`).
- `Recent Reminder Events` on `/admin/cron` is driven by reminder event rows in `audit_logs` (`entity_type=booking`).
- If a reminder job runs and sends zero emails, a run record is still written so the UI does not show stale “No runs yet”.

## Go-live readiness

Use `/admin/health` as the checklist.

For a “goLiveReady: true” signal you must have:
- Core env configured (including `CSRF_SECRET`).
- WiPay configured + reachable.
- Resend configured + reachable.
- PDFMonkey configured + reachable.
- Uploadcare public key configured + reachable.
- DB OK.

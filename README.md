# Curated Car Rentals

Next.js (App Router) + TypeScript + Tailwind, deployed on Netlify with a Neon Postgres database.

## Local development

```bash
npm install
npm run dev
```

App: `http://localhost:3000`

## Artifacts policy

- Generated audit/E2E artifacts are stored under `.artifacts/` and are gitignored.
- Do not save audit screenshots/videos/reports under `public/`.
- Playwright outputs:
  - HTML report: `.artifacts/playwright-report/`
  - Test artifacts (screenshots/videos/traces): `.artifacts/test-results/`
- Run E2E against an existing local server:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

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
- Clerk auth requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`.
- Public form bot protection requires `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
- `CSP_REPORT_ONLY=true` switches CSP to report-only mode (default behavior is enforce in production).

### Netlify environment variable setup

Set all values from `.env.example` in Netlify:
1. Netlify dashboard → Site configuration → Environment variables.
2. Add context-specific values for Clerk, Turnstile, the selected payment provider (Stripe or WiPay), Resend, the PDF provider, Bunny Storage, and database keys.
3. Deploy after saving env vars so `src/proxy.ts` and security headers run with the new values.
4. Keep secrets server-side only (`CLERK_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, payment keys, DB URLs).

## Database (Neon)

Schema file: `db/schema.sql`

Notes:
- Runtime DB access uses SQL migrations + `pg` queries. `prisma/schema.prisma` is legacy reference only and is not the runtime source of truth.
- The admin lockout feature uses `users.locked_at` and `admin_login_attempts`.
- Vehicles store image URLs in `vehicles.image_urls_json` (files are not stored in Neon).

### Migrations

We use versioned SQL migrations in `migrations/` and track applied migrations in the `schema_migrations` table.

Apply migrations locally (or against Neon) with:

```bash
npm run migrate
```

This applies pending files in filename order (e.g. `001_...sql`, `002_...sql`) and is safe to re-run.

After promo-ledger changes, verify the required schema contract before promoting app code that depends on it:

```bash
npm run migrate
npm run check:promo-ledger-schema
```

Rebuild the canonical promo ledger history locally before first shared promotion:

```bash
npm run rebuild:promo-ledger-history
npm run rebuild:promo-ledger-history -- --apply
```

The default run is a dry run and writes reconciliation output to `.artifacts/promo-ledger-reconciliation.json`.

Promotion order for promo-ledger releases:
1. Merge schema-contract changes first.
2. Run `npm run migrate`.
3. Run `npm run check:promo-ledger-schema`.
4. Run `npm run rebuild:promo-ledger-history -- --apply`.
5. Only then promote app code that depends on `promo_redemption_events`.

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

Hosted checkout payments:
- Start: `POST /api/payments/wipay/start`
- Return: `GET /api/payments/wipay/return`
- Webhook: `POST /api/payments/wipay/webhook`

Current scope: JM/JMD hosted checkout. Keep `WIPAY_COUNTRY_CODE` unset or set to `JM` unless multi-country payment support is deliberately added later.

WiPay env vars for Netlify/Lovable (see `.env.example`):
- `SITE_URL` (required; used to derive WiPay `response_url` as `${SITE_URL}/api/payments/wipay/return`)
- `WIPAY_ACCOUNT_NUMBER` (digits only)
- `WIPAY_API_KEY`
- `WIPAY_ENV` (`sandbox` or `live`)
- `WIPAY_FEE_STRUCTURE` (`customer_pay`, `merchant_absorb`, or `split`)
- `WIPAY_COUNTRY_CODE` (optional; defaults to `JM`, current site should use `JM`)
- `WIPAY_ORIGIN` (optional; defaults to `curated-car-rentals`, slug letters/numbers/dash/underscore)

Do not add `WIPAY_RESPONSE_URL` or `WIPAY_CALLBACK_URL`; the app does not read them. The webhook route exists at `POST /api/payments/wipay/webhook`, but any provider-side registration of that webhook is external WiPay/dashboard setup, not a repo env var.

## Emails (Resend)

Email sending uses Resend:
- `RESEND_API_KEY`
- `RESEND_FROM` (test senders allowed during development)

## Invoices (PDFMonkey)

Invoice PDFs are generated via PDFMonkey (and attached to emails when available):
- `PDFMONKEY_API_KEY`
- `PDFMONKEY_TEMPLATE_ID`

If PDFMonkey hits quota or is misconfigured, the UI and emails should degrade gracefully (health page will show status).

### Local Gotenberg install (alternative PDF engine)

Gotenberg is installed locally via Docker and exposed on `http://localhost:3001`.

Start:

```bash
docker-compose -f docker-compose.gotenberg.yml up -d
```

Stop:

```bash
docker-compose -f docker-compose.gotenberg.yml down
```

Health check:

```bash
curl http://localhost:3001/health
```

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
- The active payment provider configured + reachable (Stripe test credentials on staging; the selected live provider in production).
- Resend configured + reachable.
- PDFMonkey configured + reachable.
- Active file-storage provider configured + reachable: Bunny requires both public/private
  Storage Zone credentials and the public Pull Zone URL; Uploadcare remains a legacy fallback
  while historical assets are migrated.
- DB OK.
- Promo ledger schema present (`promo_redemption_events`).

## Security docs

- Security stack overview: `docs/security/SECURITY_STACK.md`
- Cloudflare setup playbook: `docs/security/CLOUDFLARE_WAF_SETUP.md`

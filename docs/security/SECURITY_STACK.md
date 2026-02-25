# Security Stack (Baseline)

## Overview

This project uses a layered security model:

1. **Application layer (Next.js on Netlify)**
   - Clerk for customer authentication/session management.
   - Legacy custom admin session (`ccr_admin_session`) remains active during migration.
   - Cloudflare Turnstile verification on public submission endpoints.
   - Centralized HTTP security headers + CSP in `next.config.ts`.
2. **Edge layer (Cloudflare dashboard)**
   - WAF custom rules for abuse and method/path hardening.
   - Rate limiting for auth and public submission endpoints.

## What Is Implemented In App vs Cloudflare

### Implemented in app code

- Clerk provider + auth UI routes:
  - `/sign-in`
  - `/sign-up`
  - `/forgot-password`
  - `/task/reset-password`
  - `/account` (protected)
- Clerk proxy file: `src/proxy.ts`
  - `/account/**` protected with Clerk.
  - Optional admin protection toggle via `CLERK_PROTECT_ADMIN_ROUTES=1` (kept off by default to preserve legacy admin auth flow).
  - Staged admin protection covers both `/admin/**` and `/api/admin/**` (with explicit legacy login exclusions).
- Clerk password operations:
  - Self-service reset flow on `/forgot-password`.
  - Forced reset task routing on `/task/reset-password`.
- Clerk admin compatibility bridge:
  - Legacy admin cookie stays primary during migration.
  - When `CLERK_PROTECT_ADMIN_ROUTES=1`, Clerk admin sessions can map to `users` via `clerk_user_id` (or first-time email match + auto-link).
- Turnstile reusable client/server integration:
  - Widget: `src/components/security/TurnstileWidget.tsx`
  - Server verification: `src/lib/security/turnstile.ts`
  - Enforced on:
    - `POST /api/public/contact`
    - `POST /api/public/bookings`
    - `POST /api/public/returning-customer/start`
    - `POST /api/public/returning-customer/verify`
    - `POST /api/public/auth/clerk-account-setup`
- Security headers and CSP:
  - Implemented in `next.config.ts`
  - `CSP_REPORT_ONLY=true` switches CSP to report-only mode.

### Turnstile Protection Matrix

| Public route/flow | Turnstile required | Status | Notes |
| --- | --- | --- | --- |
| `POST /api/public/contact` | Yes | Enforced | Contact inquiry form. |
| `POST /api/public/bookings` | Yes | Enforced | Public reservation submit flow. |
| `POST /api/public/returning-customer/start` | Yes | Enforced | Returning-customer verification bootstrap. |
| `POST /api/public/returning-customer/verify` | Yes | Enforced | Returning-customer verification completion. |
| `POST /api/public/auth/clerk-account-setup` | Yes | Enforced | Public Clerk migration/setup endpoint. |
| `POST /api/public/pricing/quote` | No | Intentionally excluded | Read-only quote preview called frequently as user edits fields; guarded by validation + Cloudflare rate limiting. |
| `POST /api/public/promos/validate` | No | Intentionally excluded | Read-only promo preview/validation; guarded by validation + Cloudflare rate limiting. |
| `POST /api/public/bookings/[id]/promo` | No | Intentionally excluded | Requires booking context + CSRF; not anonymous submit form. |
| `POST /api/public/bookings/[id]/pay-on-pickup` | No | Intentionally excluded | Requires booking context + CSRF; not anonymous submit form. |
| `POST /api/public/auth/sync-legacy-password` | No | Intentionally excluded | Requires active Clerk session + CSRF. |

Auth UX intentionally not using Turnstile:

- `/sign-in`, `/forgot-password`, `/task/reset-password` use Clerk-hosted auth flows and abuse controls.
- Adding custom Turnstile to these flows is intentionally avoided to reduce auth-flow breakage risk.

Turnstile failure behavior:

- Production: fail closed (missing token, missing config, or failed Siteverify blocks request).
- Non-production: explicit bypass only when Turnstile keys are absent (for local development).

### Configured in Cloudflare dashboard (manual)

- WAF custom rules (path/method hardening, auth and API protection).
- Rate limiting rules for:
  - public submit endpoints
  - login/auth endpoints
  - generic `/api/**` abuse controls
- Explicit webhook/rule skip handling for payment callbacks (see `CLOUDFLARE_WAF_SETUP.md`).

## Environment Variable Checklist

Add these in Netlify (Production + Preview as needed):

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` (recommended: `/sign-in`)
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (recommended: `/sign-up`)
- `CLERK_PROTECT_ADMIN_ROUTES` (optional, default `0`)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `CSP_REPORT_ONLY` (optional, `false` for enforcement in production)
- `CSP_REPORT_URI` (optional)

Existing required env vars (DB/payments/email/etc.) remain unchanged.

Turnstile setup notes:

- Configure Cloudflare Turnstile widget hostnames to match local/preview/production domains.
- If Turnstile keys are missing in production, protected routes return a security verification error and do not proceed.
- For local development, either use Turnstile test keys or rely on explicit local bypass behavior when keys are intentionally unset.

Turnstile failure-path test:

1. Open `/contact` or `/book`, leave the security challenge incomplete, and submit.
2. Confirm the UI shows a retry-friendly verification error message.
3. Complete the challenge and resubmit.
4. Confirm submission succeeds without page reload.

Migration references:

- `docs/security/CLERK_PASSWORD_OPERATIONS.md`
- `docs/security/CLERK_ADMIN_MIGRATION.md`

## Safe Rollout Sequence

1. **Deploy code with Clerk/Turnstile/CSP changes while keeping** `CLERK_PROTECT_ADMIN_ROUTES=0`.
2. **Configure Clerk keys** in Netlify and verify:
   - `/sign-in`
   - `/sign-up`
   - `/account`
3. **Configure Turnstile keys** and verify public form submissions:
   - `/contact`
   - `/book`
   - Returning customer modal in `/book`
   - `/sign-up` account setup form
4. **Run CSP in report-only first** (`CSP_REPORT_ONLY=true`) and review violations.
5. **Switch CSP enforcement on** (`CSP_REPORT_ONLY=false`) after allowlist validation.
6. **Apply Cloudflare WAF + Rate Limiting** using `docs/security/CLOUDFLARE_WAF_SETUP.md`.
7. Review password operations playbook: `docs/security/CLERK_PASSWORD_OPERATIONS.md`.
8. Optional: stage admin migration with `CLERK_PROTECT_ADMIN_ROUTES=1` in Preview first.
9. Optional: migrate admin auth to Clerk completely after cutover checklist passes.

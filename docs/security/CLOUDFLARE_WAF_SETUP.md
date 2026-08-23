# Cloudflare WAF + Rate Limiting Setup

Use this as the starter dashboard configuration for this repository.

## Route Inventory (from current codebase)

- Public form/API submissions:
  - `POST /api/public/contact`
  - `POST /api/public/bookings`
  - `POST /api/public/returning-customer/start`
  - `POST /api/public/returning-customer/verify`
  - `POST /api/public/auth/clerk-account-setup`
- Auth surfaces:
  - `GET/POST /sign-in/**` (Clerk)
  - `GET/POST /sign-up/**` (Clerk)
  - `GET /admin/login` (legacy admin UI)
  - `POST /api/admin/login` (legacy admin API)
- Generic APIs:
  - `/api/**`
- Payment callbacks:
  - `POST /api/payments/stripe/webhook` (must not be challenged; signature verification remains mandatory)
  - `GET /api/payments/stripe/return` (normal customer browser traffic)

## WAF Custom Rules (Starter Set)

Create rules in this order:

### Rule 1: Skip challenge controls for the Stripe webhook

- Expression:
  - `(http.request.uri.path eq "/api/payments/stripe/webhook" and http.request.method eq "POST")`
- Action:
  - `Skip`
- Skip phases/products:
  - WAF Managed Rules
  - Rate Limiting Rules
  - Super Bot Fight Mode
- Notes:
  - Prevents payment callback failures caused by challenges.
  - The application still verifies the raw request body with `STRIPE_WEBHOOK_SECRET`; the WAF skip is not authentication.
  - For defense in depth, restrict this path to Stripe's published webhook IP addresses and keep that list current.

### Rule 2: Block invalid methods on public submit endpoints

- Expression:
  - `(http.request.uri.path in {"/api/public/contact" "/api/public/bookings" "/api/public/returning-customer/start" "/api/public/returning-customer/verify" "/api/public/auth/clerk-account-setup"} and http.request.method ne "POST")`
- Action:
  - `Block`

### Rule 3: Managed challenge on auth attack surfaces

- Expression:
  - `((http.request.uri.path eq "/api/admin/login") or (http.request.uri.path eq "/admin/login") or starts_with(http.request.uri.path, "/sign-in") or starts_with(http.request.uri.path, "/sign-up")) and not cf.client.bot`
- Action:
  - `Managed Challenge`

### Rule 4: Managed challenge for admin API scanning

- Expression:
  - `(starts_with(http.request.uri.path, "/api/admin/") and http.request.uri.path ne "/api/admin/login" and not cf.client.bot)`
- Action:
  - `Managed Challenge`
- Notes:
  - Keep this as `Managed Challenge` first; move to `Block` only after observing normal traffic.

## Rate Limiting Rules (Starter Set)

Use source characteristic: `IP`.

### RL 1: Contact form abuse

- Match:
  - `http.request.uri.path eq "/api/public/contact" and http.request.method eq "POST"`
- Threshold:
  - `8 requests / 10 minutes`
- Action:
  - `Managed Challenge`

### RL 2: Booking submission abuse

- Match:
  - `http.request.uri.path eq "/api/public/bookings" and http.request.method eq "POST"`
- Threshold:
  - `6 requests / 10 minutes`
- Action:
  - `Managed Challenge`

### RL 3: Returning customer lookup abuse

- Match:
  - `(http.request.uri.path eq "/api/public/returning-customer/start" or http.request.uri.path eq "/api/public/returning-customer/verify") and http.request.method eq "POST"`
- Threshold:
  - `10 requests / 10 minutes`
- Action:
  - `Managed Challenge`

### RL 3b: Clerk account setup abuse

- Match:
  - `http.request.uri.path eq "/api/public/auth/clerk-account-setup" and http.request.method eq "POST"`
- Threshold:
  - `6 requests / 10 minutes`
- Action:
  - `Managed Challenge`

### RL 4: Legacy admin login brute force

- Match:
  - `http.request.uri.path eq "/api/admin/login" and http.request.method eq "POST"`
- Threshold:
  - `10 requests / 10 minutes`
- Action:
  - `Block for 30 minutes`

### RL 5: Generic API flood protection

- Match:
  - `starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/payments/stripe/webhook"`
- Threshold:
  - `120 requests / 1 minute`
- Action:
  - `Managed Challenge`

## Webhook and Callback Exceptions

Do not challenge:

- `POST /api/payments/stripe/webhook`

Do not create a callback exemption for:

- `GET /api/payments/stripe/return` (this is normal customer browser traffic and can use the standard site rules)

Recommended:

- Add a dedicated rule to log (not block) abnormal non-POST requests to webhook path.
- Allowlist Stripe's published webhook IP addresses when operationally feasible.
- Treat Stripe signature verification in application code as mandatory even when IP restrictions are enabled.

## Bot Protection Notes

- Cloudflare challenge rules are **additional** to Turnstile in app code.
- Turnstile remains the form-level proof-of-human check.
- Start with challenge/log actions for at least 24-48 hours before tightening to block.

## Testing Checklist

1. Submit `/contact` and `/book` normally from a browser (should pass).
2. Use repeated POSTs from one IP to confirm rate-limiting triggers.
3. Verify `/api/payments/stripe/webhook` is not challenged.
4. Verify an invalid or missing Stripe signature returns HTTP 400, then verify a signed Stripe test event is accepted.
5. Verify `/api/payments/stripe/return` and the admin login UI/API still function under normal browser rules.
6. Review Cloudflare Security Events and adjust thresholds before enforcing stricter blocks.

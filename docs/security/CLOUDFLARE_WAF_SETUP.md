# Cloudflare WAF + Rate Limiting Setup

Use this as the starter dashboard configuration for this repository.

## Route Inventory (from current codebase)

- Public form/API submissions:
  - `POST /api/public/contact`
  - `POST /api/public/bookings`
  - `POST /api/public/returning-customer/start`
  - `POST /api/public/returning-customer/verify`
- Auth surfaces:
  - `GET/POST /sign-in/**` (Clerk)
  - `GET/POST /sign-up/**` (Clerk)
  - `GET /admin/login` (legacy admin UI)
  - `POST /api/admin/login` (legacy admin API)
- Generic APIs:
  - `/api/**`
- Payment callbacks:
  - `POST /api/payments/wipay/webhook` (must not be challenged)
  - `GET /api/payments/wipay/return`

## WAF Custom Rules (Starter Set)

Create rules in this order:

### Rule 1: Skip security controls for WiPay webhook

- Expression:
  - `(http.request.uri.path eq "/api/payments/wipay/webhook" and http.request.method eq "POST")`
- Action:
  - `Skip`
- Skip phases/products:
  - WAF Managed Rules
  - Rate Limiting Rules
  - Super Bot Fight Mode
- Notes:
  - Prevents payment callback failures caused by challenges.
  - If WiPay provides fixed IPs, add an additional allowlist rule and block non-allowlisted webhook calls.

### Rule 2: Block invalid methods on public submit endpoints

- Expression:
  - `(http.request.uri.path in {"/api/public/contact" "/api/public/bookings" "/api/public/returning-customer/start" "/api/public/returning-customer/verify"} and http.request.method ne "POST")`
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

### RL 4: Legacy admin login brute force

- Match:
  - `http.request.uri.path eq "/api/admin/login" and http.request.method eq "POST"`
- Threshold:
  - `10 requests / 10 minutes`
- Action:
  - `Block for 30 minutes`

### RL 5: Generic API flood protection

- Match:
  - `starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/payments/wipay/webhook"`
- Threshold:
  - `120 requests / 1 minute`
- Action:
  - `Managed Challenge`

## Webhook and Callback Exceptions

Do not challenge:

- `POST /api/payments/wipay/webhook`

Do not rate-limit too aggressively:

- `GET /api/payments/wipay/return` (user browser returns from payment flow)

Recommended:

- Add a dedicated rule to log (not block) abnormal non-POST requests to webhook path.
- If WiPay sends from stable IP ranges, allowlist those IPs and block other webhook callers.

## Bot Protection Notes

- Cloudflare challenge rules are **additional** to Turnstile in app code.
- Turnstile remains the form-level proof-of-human check.
- Start with challenge/log actions for at least 24-48 hours before tightening to block.

## Testing Checklist

1. Submit `/contact` and `/book` normally from a browser (should pass).
2. Use repeated POSTs from one IP to confirm rate-limiting triggers.
3. Verify `/api/payments/wipay/webhook` is not challenged.
4. Verify admin login UI/API still function under normal use.
5. Review Cloudflare Security Events and adjust thresholds before enforcing stricter blocks.


# WiPay retirement security audit

Date: 2026-08-23  
Scope: `customer/main...codex/wipay-followup-cleanup`  
Decision: suitable for staging; production remains gated on final staging verification.

## Executive summary

No critical, high, or medium security findings were identified in the WiPay retirement changes. The active public payment flow is Stripe-only and fails closed when the deployment, key mode, provider, or webhook secret is inconsistent. Historical WiPay rows remain labelled as WiPay and can be adjusted by authorized administrators, but no code can start a new WiPay payment or call the retired WiPay runtime.

The production dependency audit reports zero known vulnerabilities across 160 production dependencies. Focused payment, authorization, CSRF, CSP, retirement-guard, and error-sanitization tests pass (49/49).

## Controls reviewed

- Provider selection: `src/lib/payments/provider.ts:61-90` permits only Stripe, requires a live key in production, requires a test key on staging, and validates the Stripe webhook-secret format.
- Public payment authorization: `src/lib/payments/publicPaymentStart.ts:326-340` locks the booking and verifies signed public booking access before payment state is read or changed.
- Duplicate payment protection: `src/lib/payments/publicPaymentStart.ts:375-423` reuses or blocks recent attempts and safely expires stale Stripe sessions before replacement.
- Stripe reconciliation: `src/lib/payments/stripeReconcile.ts:135-178` verifies mode, currency, stored provider, session amount, and locked payment state before recording payment.
- Webhook authenticity and replay handling: `src/app/api/payments/stripe/webhook/route.ts:7-24` verifies the Stripe signature against the raw body and deduplicates event IDs; failed reconciliation removes the marker so Stripe can retry.
- Administrative payment mutations: `src/app/api/admin/payments/[paymentId]/refund/route.ts:12-22` requires an authorized admin and a valid CSRF token. Stripe refunds use the stored Payment Intent and an idempotency key at lines 90-105. Historical WiPay adjustments remain accounting-only and make no provider call.
- Database access: reviewed payment queries use parameters; payment and refund decisions lock the relevant row before mutation.
- Error exposure: production public-payment errors omit debug data, and `src/lib/payments/formatHistoricalPaymentError.ts:93-110` removes stored raw provider responses before rendering admin diagnostics.
- Secret handling: only `.env.example` is tracked. No secret-looking value was found in the changed files, and server credentials are not exposed through `NEXT_PUBLIC_*` variables.
- Response hardening: `next.config.ts:134-154` applies CSP or nonce-CSP, referrer, content-type, frame, permissions, and HSTS headers.

## Findings

### SEC-001 — Low — Static CSP fallback permits inline scripts

`next.config.ts:83-91` includes `'unsafe-inline'` in the static fallback policy for the existing theme bootstrap. The request-specific CSP in `src/proxy.ts:21-57` uses a nonce and removes that script exception when the nonce rollout flags are enabled. This is pre-existing and not introduced by the WiPay retirement, but production should continue using the nonce policy.

Required production check: confirm `CSP_NONCE_ENABLED=true`, `NEXT_PUBLIC_CSP_NONCE_ENABLED=true`, and `CSP_REPORT_ONLY=false` before final release verification.

## Operational release gates

1. Redeploy after the completed Netlify environment cleanup so removal of the six `WIPAY_*` variables reaches the runtime.
2. Complete staging smoke tests for Stripe Checkout, signed webhook reconciliation, admin diagnostics, historical WiPay labels, and operator authorization before merging to production.
3. Re-run lint, build, focused tests, and the repository test suite on the final commit. Existing unrelated suite failures must be recorded and compared with the established baseline; no new payment-related failure is acceptable.
4. Complete one normal production Turnstile-protected form submission after deployment. The staging widget currently reports successful server-side Siteverify requests; the production widget reports no Siteverify requests in the reviewed 24-hour window, which is consistent with no protected form submission but must be confirmed after release.

## Cloudflare external-state review

- The account has no Cloudflare-managed domains or subdomains.
- Account-level WAF is not configured and the dashboard offers it only as an Enterprise add-on. Therefore, no deployed WiPay webhook exception or rate-limit rule exists to remove or convert.
- Turnstile is configured independently of Cloudflare proxying. Staging reports four Siteverify requests with four valid tokens in the reviewed 24-hour window.
- The production widget reports challenges but no Siteverify request in that window. Repository code calls Siteverify and fails closed when configuration, token validation, or action validation fails (`src/lib/security/turnstile.ts:96-178`). Secret values are masked by Netlify and were not exposed during this audit.

## Verification evidence

- `npm audit --omit=dev --json`: 0 critical, high, moderate, low, or informational production vulnerabilities.
- Focused Node test set: 49 passed, 0 failed.
- Static scan: no `eval`, `new Function`, child-process execution, permissive CORS header, or client-exposed secret pattern in the reviewed payment/security paths.
- Retirement guards verify that retired WiPay routes and runtime libraries remain absent.

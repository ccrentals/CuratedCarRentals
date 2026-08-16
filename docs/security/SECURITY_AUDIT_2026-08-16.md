# Curated Car Rentals Security Audit

**Audit date:** 2026-08-16  
**Scope:** `curatedcarrentals.com`, the Next.js/TypeScript application at commit `f5ec6e0`, and safe read-only configuration evidence.  
**Method:** The approved comprehensive audit checklist supplied for this engagement, repository static review, dependency analysis, automated regression tests, production response/DNS checks, and safe public-path checks. No destructive, volumetric, or customer-data tests were performed.

## Executive summary

The application has a strong code-level baseline: authenticated administration, CSRF controls, Turnstile coverage, signed/expiring session handling, private Bunny storage, upload signature checks for raster images, nonce-based CSP, and security-focused regression tests.

No critical or high production-runtime vulnerability was identified from the evidence collected. Production dependency scanning (`npm audit --omit=dev --audit-level=high`) reported no high or critical finding. The main work remaining is operational: remove the remaining CSP inline-style exception, define a malware-scanning workflow for document uploads, update development-tool dependencies, verify provider controls, finish the Clerk admin cutover, and raise DMARC enforcement after mail-alignment monitoring.

## Status legend

- **PASS** — evidence supports the control in the reviewed scope.
- **WARNING** — a weakness or incomplete hardening remains.
- **BLOCKED** — cannot be verified from source or safe external checks; required evidence is stated.
- **NOT APPLICABLE** — feature is absent from the reviewed production web application.

## Evidence collected

- `node --import tsx --test test/staticGuards.test.ts test/envSecretSeparation.test.ts test/bunnyStorage.test.ts test/healthAttestation.test.ts test/rasterImageValidation.test.ts` — **40 passing tests**.
- `npm audit --omit=dev --audit-level=high` — **0 high/critical production dependencies**.
- `npm audit` — 5 high findings in development-only ESLint/glob dependency paths; see SEC-002.
- Production `HEAD https://curatedcarrentals.com` — nonce CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, restrictive `Permissions-Policy`, and `Referrer-Policy` present.
- Safe public checks: `/.env`, `/.git/HEAD`, and a nonexistent source map return `404`; `/api/health/ready` returns only `{"ok":true}`.
- DNS: SPF is present; DMARC is `p=none` and requires a monitored rollout before enforcement.

## Audit matrix

| Checklist area | Status | Evidence and next action |
| --- | --- | --- |
| 1. Application inventory | PASS | Next.js 16 / TypeScript / React on Netlify; Clerk, Bunny, Stripe/WiPay, Resend, PDFMonkey and PostgreSQL are identified in code and [SECURITY_STACK.md](./SECURITY_STACK.md). |
| 2. External attack surface | WARNING | Canonical site and staging are known, and common sensitive paths were safely checked. Full subdomain/CT/DNS takeover review requires DNS/Cloudflare inventory access. |
| 3. HTTPS/TLS | PASS | HTTPS, HSTS, and canonical public response were verified. Certificate expiry, cipher suite, and origin-exposure evidence should be recorded in a provider attestation. |
| 4. HTTP security headers | WARNING | Nonce CSP, HSTS, `nosniff`, frame denial, permissions and referrer policies are live. `style-src 'unsafe-inline'` remains; see SEC-001. |
| 5. Authentication | WARNING | Clerk and legacy admin flows have code/test coverage, but MFA, Clerk dashboard settings, and brute-force/rate-limit event evidence require provider/Cloudflare review. |
| 6. Session security | WARNING | Legacy cookie is HMAC-signed, `HttpOnly`, `SameSite=Lax`, secure in production, and has a 20-minute idle limit in `src/lib/auth/session.ts`. Dual legacy/Clerk operation remains; see SEC-004. |
| 7. Authorization/access control | BLOCKED | Admin guards and selected 403 static checks pass. Full horizontal/vertical IDOR testing needs non-production accounts and fixtures for each role/customer boundary. |
| 8. Input validation/injection | WARNING | Input validation, parameterized database helpers, and focused security guards exist, but a full route-by-route taint/injection review remains to be completed. |
| 9. XSS | WARNING | React is the primary renderer; the only direct HTML insertion found is structured JSON-LD. The live nonce CSP limits scripts, but inline styles weaken defense in depth; see SEC-001. |
| 10. CSRF/request integrity | PASS | Shared CSRF verification is used for state-changing protected flows and logout is POST-only; static regression test passes. |
| 11. CORS | BLOCKED | No permissive CORS header is defined in reviewed application code. Netlify/Cloudflare response behavior and third-party callback CORS require runtime/provider evidence. |
| 12. SSRF | WARNING | Third-party outbound calls are present for known providers (Stripe/WiPay/Resend/PDFMonkey/Bunny/Uploadcare). A targeted review of every URL-derived fetch/download path remains. |
| 13. File uploads | WARNING | Bunny private/public scopes, size/type controls, traversal-resistant keys, and raster magic-byte validation are tested. General document/PDF malware scanning/quarantine is absent; see SEC-003. |
| 14. APIs/webhooks | WARNING | Auth, CSRF, webhook idempotency/signature controls and narrow readiness response have tests. Complete endpoint authorization and webhook replay testing needs non-production fixtures/provider callbacks. |
| 15. Business logic/payments | WARNING | Shared pricing/entitlement and payment reconciliation guards pass static tests. End-to-end race, duplicate callback, coupon, and payment-provider tests remain. |
| 16. Sensitive information exposure | PASS | `.env` and common Git paths are ignored/not exposed in safe probes; health output is intentionally minimal; secret/client separation tests pass. Continue secret scanning in CI and verify Netlify environment access. |
| 17. Source/dependency review | WARNING | No production high/critical dependency finding. Development dependency advisories and the remaining route-by-route static review are open; see SEC-002. |

## Findings

### SEC-001 — CSP permits inline styles

- **Severity:** Medium
- **Location:** `src/proxy.ts`, `buildNonceCsp`, `style-src 'self' 'unsafe-inline'`.
- **Evidence:** Production currently returns the same directive. The stricter inline-style reduction exists on staging but is not in the reviewed production commit.
- **Impact:** A future HTML/style injection defect has more presentation-control impact than it would under a fully nonce/hash-restricted style policy.
- **Remediation:** Promote the isolated inline-style reduction after staging visual verification; do not merge unrelated staging work into production.
- **Validation:** Customer pages, admin pages, Clerk screens, payment return pages, and Turnstile must load with no CSP violations.

### SEC-002 — Development dependency advisories remain

- **Severity:** Low
- **Location:** development dependency tree via `eslint-config-next` / ESLint tooling (`brace-expansion`, `flatted`, `js-yaml`, `minimatch`, `picomatch`).
- **Evidence:** `npm audit` reports 5 high advisories, while `npm audit --omit=dev --audit-level=high` is clean.
- **Impact:** The production bundle is not affected, but vulnerable tooling increases build/CI workstation risk if it processes hostile repositories or inputs.
- **Remediation:** Update ESLint/Next lint tooling in a dedicated lockfile-only change and rerun lint, type checks, security tests, and `npm audit`.

### SEC-003 — Uploaded documents do not receive malware scanning/quarantine

- **Severity:** Medium
- **Location:** document upload flows and [PRODUCTION_RELEASE_ATTESTATION.md](./PRODUCTION_RELEASE_ATTESTATION.md).
- **Evidence:** Raster files receive MIME/signature checks and Bunny keys are scoped; the documented release prerequisites explicitly note that malware scanning is not configured for expanded uploads.
- **Impact:** Malicious PDFs or documents could be stored and later downloaded by staff, despite type/size validation.
- **Remediation:** Add an asynchronous malware scanner/quarantine state before files are available for download; retain current type, size, access-control, and path-validation controls.

### SEC-004 — Legacy admin sessions remain during Clerk migration

- **Severity:** Medium
- **Location:** `src/lib/auth/session.ts` and [CLERK_ADMIN_CUTOVER_RUNBOOK.md](./CLERK_ADMIN_CUTOVER_RUNBOOK.md).
- **Evidence:** The code explicitly retains legacy cookies as the primary source until the Clerk cutover is complete.
- **Impact:** Two authentication systems increase operational complexity and extend the compatibility code’s attack surface.
- **Remediation:** Complete the documented preconditions in staging, enable `CLERK_PROTECT_ADMIN_ROUTES=1` there, verify role mapping/session behavior, then schedule the production cutover and legacy removal.

### SEC-005 — DMARC is monitoring-only

- **Severity:** Medium
- **Location:** public DNS `_dmarc.curatedcarrentals.com`.
- **Evidence:** `v=DMARC1; p=none;`.
- **Impact:** Spoofed mail using the domain is monitored rather than requested to be quarantined/rejected by recipients.
- **Remediation:** Confirm SPF and DKIM alignment/reporting, then advance gradually to `p=quarantine` and ultimately `p=reject`.

## Blocked provider evidence

These controls must not be marked complete until the indicated evidence is collected:

| Provider/control | Evidence required |
| --- | --- |
| Netlify release attestation | Matching staging/production SHA, deploy IDs/URLs, protected health page, readiness response, rollback deploy ID; follow [PRODUCTION_RELEASE_ATTESTATION.md](./PRODUCTION_RELEASE_ATTESTATION.md). |
| Cloudflare WAF/rate limits | Dashboard rules and Security Events for documented public, admin, and webhook exceptions; follow [CLOUDFLARE_WAF_SETUP.md](./CLOUDFLARE_WAF_SETUP.md). |
| Bunny | Separate public/private zones, server-only private keys, and controlled cross-customer read/delete denial test. |
| Clerk | Production keys/domain configuration, MFA policy decision, dashboard session policy, and staged admin cutover evidence. |
| Stripe/WiPay/Resend | Provider webhook configuration, signing-secret rotation status, callback replay evidence, and least-privilege API-key review. |
| DNS/mail | DKIM selector records, DMARC aggregate reports, and a planned enforcement rollout. |

## Remediation sequence

1. Promote and verify SEC-001 as an isolated production change.
2. Update SEC-002 development tooling in a separate dependency-only batch.
3. Design SEC-003 malware scanning/quarantine before allowing broader document types/volumes.
4. Complete the external-provider evidence table and production release attestation.
5. Perform the staged Clerk cutover in SEC-004.
6. Advance DMARC only after SPF/DKIM alignment and monitoring are confirmed.

## Completion criteria

This audit is not complete until every BLOCKED/WARNING entry has either been remediated and retested, formally accepted with a risk owner/date, or shown not applicable with evidence. Update this document after each remediation and attach only non-secret identifiers/outcomes.

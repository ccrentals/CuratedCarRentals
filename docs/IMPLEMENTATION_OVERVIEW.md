# Curated Car Rentals — implementation overview

This document is a high-level record of the platform improvements completed
through August 2026. It is intended for business owners and operations staff;
technical implementation details and release procedures live in the linked
runbooks.

## At a glance

| Area | What changed | Outcome |
| --- | --- | --- |
| Media storage | Migrated supported public and private uploads from Uploadcare workflows to Bunny Storage. | Public media is served through Bunny CDN; sensitive files remain private and are delivered through authorized application routes. |
| Payments | Completed the Stripe production cutover and retired WiPay payment entrypoints. | Production uses live Stripe only; staging stays in Stripe test mode, while historical WiPay ledger records retain their original labels. |
| Security | Added stronger application, upload, deployment, and browser protections. | Reduced exposure of operational data, hardened file handling, and added automated security checks. |
| Operations | Added release attestation and updated runbooks. | Staff can verify which commit and Netlify release is running without exposing secrets publicly. |

## 1. Bunny.net media storage

**Description:** Bunny Storage is now the main home for CCR media. Public
vehicle and website images can be delivered quickly through the Bunny CDN,
while customer identification, inspection evidence, and operational documents
stay private and can only be retrieved by authorized users through CCR.

### Implemented

- Created separate Bunny Storage zones for public and private media in staging
  and production.
- Connected the public zone to the Bunny pull zone/CDN so public images are
  delivered from the CDN.
- Added environment-specific Bunny configuration in Netlify for storage zones,
  storage credentials, endpoint, public CDN URL, and storage-provider
  selection.
- Migrated these workflows to Bunny Storage:
  - vehicle gallery images;
  - landing-page and services images;
  - customer identification images;
  - booking pickup/return inspection images;
  - vehicle, maintenance, and booking documents.
- Applied consistent storage organization and readable business identifiers,
  including customer ID prefixes for identification images.
- Kept private files behind authenticated application endpoints rather than
  exposing private Bunny URLs directly.

### Upload safeguards

- Uploads require the relevant admin/operations access and CSRF protection.
- The application restricts upload purpose, count, file size, and supported
  image types.
- JPEG, PNG, WebP, HEIC, and HEIF uploads are checked against their actual file
  signatures before an object is stored, which blocks spoofed image types.
- Storage object keys are generated and scope-checked to prevent path traversal.

### Remaining external follow-up

Signature validation is not malware scanning. A scanning/quarantine provider
still needs to be selected and configured before accepting broader file types.

Related detail: [Bunny Storage operations](security/BUNNY_STORAGE_OPERATIONS.md)
and [security stack](security/SECURITY_STACK.md).

## 2. Stripe and payments

**Description:** Stripe now supports the customer payment journey from booking
through confirmation and administration. The system separates real production
payments from staging test payments, so testing cannot accidentally use live
payment settings.

### Implemented

- Completed the Stripe Checkout integration for bookings, including deposit,
  balance, full-payment, and approved custom-payment paths.
- Added webhook signature verification, reconciliation, idempotency handling,
  receipt/status updates, and safe refund/reconciliation handling for admin
  workflows.
- Corrected JMD pricing conversion and ensured booking pricing is calculated
  from shared server-side pricing data rather than browser values.
- Separated runtime behavior by deployment context:
  - production uses live Stripe credentials with `STRIPE_TEST_MODE=false`;
  - staging uses Stripe test credentials with `STRIPE_TEST_MODE=true`.
- Updated runtime detection so the public custom domain resolves as production
  even when Netlify function context variables are incomplete.

### Operational guardrail

The public readiness endpoint no longer reveals payment configuration or
provider diagnostics. It only returns `{ "ok": true|false }`; detailed health
information is available only in the developer-protected admin area.

Related detail: [production release attestation](security/PRODUCTION_RELEASE_ATTESTATION.md)
and [security stack](security/SECURITY_STACK.md).

## 3. Security measures

**Description:** Security controls are layered across the browser, application,
deployment process, and third-party services. The goal is to prevent
unauthorized actions, reduce the chance of harmful uploads or abuse, and make
production releases easier to verify.

### Identity, access, and abuse protection

- Upgraded patched Clerk and Next.js dependencies and resolved the related
  production dependency advisories.
- Added/maintained server-side role enforcement for sensitive admin actions.
- Made logout POST-only and CSRF-protected.
- Applied signed CSRF protection across reviewed cookie-authenticated writes.
- Added Cloudflare Turnstile verification to public contact, booking,
  returning-customer, and Clerk-account-setup submissions.
- Added rate-limit and abuse-control coverage for high-risk public/auth flows.

### Browser and application hardening

- Enforced HTTPS, HSTS, `nosniff`, clickjacking protection, referrer policy,
  and restrictive permissions policy headers.
- Replaced executable CSP inline-script permission with a per-request nonce.
- Reduced legacy Uploadcare origins to only the CSP directives that still need
  them during migration.
- Moved static UI styling out of React inline-style attributes and added a test
  to stop those static cases returning. Remaining inline styles are limited to
  runtime-calculated values such as menu position, image URLs, and report data.

### Release controls

- Added a GitHub Actions Security Gate for pull requests and pushes to
  `staging`/`main`.
- The gate runs locked dependency installation, production dependency audit,
  TypeScript validation, and focused security regressions.
- Added non-secret Netlify release markers to the developer-protected health
  page: context, branch, commit, deploy ID, site ID, and deploy URL.

Related detail: [security stack](security/SECURITY_STACK.md) and
[production security audit](security/production-security-audit-2026-08-11.md).

## 4. Current release approach

**Description:** Releases move from local verification to staging and then to
production. This prevents unverified changes from reaching customers and keeps
the deployed version traceable to a specific GitHub commit and Netlify deploy.

1. Make and verify changes locally using build, TypeScript, and targeted tests.
2. Commit and push to `staging`; verify the Netlify staging deployment.
3. Promote the verified change to `main`; verify the production deployment and
   release-attestation markers.
4. Record any provider-side work separately from code changes.

## 5. Remaining provider-controlled work

**Description:** These items cannot be safely completed in application code
alone. They need a selected third-party service or access to the domain/DNS
provider, and should be completed under the account owner's change process.

- Select and configure malware scanning/quarantine for uploads.
- In the DNS provider, monitor aligned SPF/DKIM mail and progress DMARC from
  `p=none` to `p=quarantine`, then `p=reject`.
- Run controlled cross-role/cross-customer private-file authorization tests
  using dedicated test accounts.
- Continue migrating the remaining runtime-generated presentation styles before
  removing CSP `style-src 'unsafe-inline'`.

## References

- [Security stack](security/SECURITY_STACK.md)
- [Bunny Storage operations](security/BUNNY_STORAGE_OPERATIONS.md)
- [Production release attestation](security/PRODUCTION_RELEASE_ATTESTATION.md)
- [Production security audit](security/production-security-audit-2026-08-11.md)

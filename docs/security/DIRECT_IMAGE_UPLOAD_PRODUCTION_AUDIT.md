# Direct Image Upload Production Audit

Audit date: 2026-08-23

Scope: Operations/Admin browser uploads, Netlify authorization/finalization routes, Bunny Edge Script streaming, public/private Bunny Storage isolation, database finalization, cleanup, CSP, release configuration, and rollback.

## Executive summary

The direct-upload design removes image bytes from Netlify request bodies and supports raster images through 50 MiB. The reviewed implementation uses authenticated and CSRF-protected authorization/finalization calls, random one-time tokens stored only as SHA-256 hashes, server-generated storage paths, exact origin CORS, separate public/private zones, byte-count and checksum enforcement, transactional finalization, audit records, and orphan cleanup.

Production promotion is approved only after DIU-003 is closed by provisioning a separate production gateway and configuring its URL and shared secret. No staging gateway, zone, secret, or application origin may be reused in production.

## Findings

### DIU-001 — Claimed MIME type was not independently validated

- Rule ID: NEXT-FILES-001 / REACT-FILE-001
- Severity: Medium
- Status: Resolved in this release
- Location: `bunny/edge-upload-gateway/index.ts` (`imageSignatureMatches` and upload transform); `src/lib/uploads/directUpload-client.ts` (`confirmEligibleFiles`)
- Evidence: The release candidate originally compared only `Content-Type` with the authorized MIME. The gateway now checks raster signatures while streaming, and the browser performs the same check before authorization.
- Impact: An authenticated uploader could otherwise store arbitrary bytes while labelling them as an allowed image type.
- Fix: Enforce JPEG, PNG, WebP, HEIC, or HEIF signatures at the gateway; retain client validation only as early UX feedback.
- Mitigation: Bunny checksum enforcement and `nosniff` remain defense in depth.
- False positive notes: File extensions are not trusted and SVG/HTML are not accepted.

### DIU-002 — Operations could request public-content upload tokens

- Rule ID: NEXT-AUTH-001 / REACT-AUTHZ-001
- Severity: Medium
- Status: Resolved in this release
- Location: `src/app/api/admin/uploads/direct/authorize/route.ts` (`POST`)
- Evidence: The staging candidate restricted landing content but did not also restrict vehicle-gallery purpose. The production port requires Admin/Developer access for both public-content purposes.
- Impact: An Operations user with a known vehicle identifier could consume public storage even though the later vehicle save API remained protected.
- Fix: Operations is limited to `CUSTOMER_LEGAL_ID` and `INSPECTION_IMAGE`; public gallery/landing purposes require Admin/Developer.
- Mitigation: Server-generated opaque paths and the active-session cap further constrain abuse.
- False positive notes: Operations retains the two private-image purposes required by its customer and booking workflows.

### DIU-003 — Production gateway configuration absent

- Rule ID: NEXT-SECRETS-001 / NEXT-CORS-001
- Severity: High
- Status: Release gate
- Location: Netlify production environment and Bunny Edge Script inventory
- Evidence: Production Bunny public/private zones exist, but the audit found no production Edge Script and no production values for `DIRECT_IMAGE_UPLOAD_GATEWAY_URL` or `DIRECT_IMAGE_UPLOAD_GATEWAY_SHARED_SECRET`.
- Impact: Promoting application code before configuration would fail uploads; reusing staging resources would break environment isolation.
- Fix: Create a production-only script, configure exact production origins, production zone keys, and a new shared secret; set only the gateway URL and matching shared secret in Netlify.
- Mitigation: The upload authorization route returns a configuration error when the gateway is
  absent, while CSP rejects a configured non-HTTPS or non-origin gateway value at build time.
- False positive notes: Existing Bunny storage variables are present and were not exposed or changed by this audit.

### DIU-004 — Bunny account does not show two-factor authentication

- Rule ID: Operational account security
- Severity: Medium
- Status: Open follow-up
- Location: Bunny account dashboard security notice
- Evidence: The signed-in dashboard displays a notice that two-factor authentication is not enabled.
- Impact: Account compromise could expose storage zones, access keys, CDN configuration, and Edge Scripts.
- Fix: Enable Bunny account 2FA and store recovery codes securely.
- Mitigation: Application upload tokens are one-time, short-lived, path-bound, and do not expose Bunny keys.
- False positive notes: Verify whether the account is protected by an upstream SSO control not visible in the Bunny dashboard.

### DIU-005 — Gateway necessarily holds zone-level storage keys

- Rule ID: NEXT-SECRETS-001
- Severity: Low
- Status: Accepted architectural constraint
- Location: `bunny/edge-upload-gateway/index.ts` (`env` and storage request)
- Evidence: Bunny Storage access keys are zone-scoped rather than per-object-path. The gateway therefore holds the public and private zone keys.
- Impact: Compromise of the Edge Script environment could permit broader access within those zones.
- Fix: Keep separate production public/private zones, never expose keys to the browser, and rotate keys/shared secrets after suspected compromise.
- Mitigation: Exact-origin CORS, one-time application tokens, server-generated keys, audit records, private-zone delivery controls, and separate staging resources.
- False positive notes: Browser tokens do not contain or derive Bunny access keys.

### DIU-006 — Production dependency advisory in transitive merge utility

- Rule ID: Dependency hygiene
- Severity: High
- Status: Resolved in this release
- Location: `package.json` (`overrides`) and `package-lock.json`
- Evidence: The production dependency audit initially identified the affected `deepmerge-ts` 7.x
  transitive dependency. The lockfile now resolves `deepmerge-ts` 8.0.2, and
  `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities.
- Impact: Keeping the affected transitive version would leave a known high-severity production
  dependency advisory in the release graph.
- Fix: Pin the transitive package to the patched 8.0.2 release and verify a clean reproducible
  install, type-check, build, and production dependency audit.
- Mitigation: The GitHub Security Gate repeats the production dependency audit on the pull request
  and on `main`.
- False positive notes: The broader development-only dependency graph still reports tooling
  advisories; those packages are not installed in the production dependency audit scope.

## Release gates

- Production script uses `https://curatedcarrentals.com` as `APP_ORIGIN` and the sole allowed browser origin.
- Production script uses `https://ny.storage.bunnycdn.com` and the production public/private zone credentials.
- Netlify production has the production gateway URL and matching shared secret.
- CSP contains the production gateway origin and no staging gateway origin.
- Migration `051_direct_image_upload_sessions.sql` applies transactionally.
- TypeScript, lint, production build, direct-upload tests, dependency audit, and the repository's
  Security Gate pass. Any unrelated failures in the legacy full test suite are recorded separately
  and compared against the current `main` baseline rather than silently waived.
- Production smoke checks reject missing/wrong tokens and wrong origins without creating objects.

## Rollback

Revert the GitHub production merge to restore the previous application upload path. Leave migration 051 in place because it is additive and unused when the direct routes are absent. Disable the production Edge Script only after rollback traffic is confirmed absent. Do not delete upload-session rows or storage objects as part of a code rollback; normal cleanup can expire unfinished sessions.

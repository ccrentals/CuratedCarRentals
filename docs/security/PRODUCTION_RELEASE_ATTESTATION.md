# Production release attestation

Use this record for every production promotion. It contains identifiers and
outcomes only; do not record environment values, API keys, cookies, customer
data, or payment details.

## Before production promotion

1. Confirm the candidate commit is present on `staging` and GitHub Actions
   **Security Gate** is successful.
2. Confirm staging `/admin/health` shows the expected Netlify branch, commit,
   deploy ID, and deploy URL. Record those non-secret values in the release
   ticket.
3. Confirm staging `/api/health/ready` is exactly `{ "ok": true }`.
4. Run the CSP browser matrix documented in `SECURITY_STACK.md`.
5. Promote the same verified commit to `main`; do not create a direct manual
   deployment from an unpushed workspace.

## After Netlify publishes production

1. Confirm Netlify reports the `main` deployment as ready and the custom domain
   resolves to it.
2. Open developer-protected `/admin/health`. Confirm its context is
   `production`, its branch is `main`, and its commit/deploy identifiers match
   the approved record.
3. Confirm the public readiness endpoint returns only `{ "ok": true }` with
   `Cache-Control: no-store`.
4. Confirm the root CSP has a fresh `script-src 'nonce-…'` on separate
   requests. Verify the browser has no CSP refusals for normal customer and
   administrator workflows.
5. Record the Git SHA, Netlify deploy ID, deploy URL, result of each validation,
   and the rollback deploy ID in the release ticket.

## Provider controls outside the repository

- **Bunny:** enforce separate public/private zones; ensure private access keys
  remain server-only; test cross-customer read/delete denial with dedicated
  non-production fixtures.
- **Mail DNS:** validate SPF/DKIM alignment before moving DMARC from `p=none`
  to `p=quarantine`, then to `p=reject` after monitoring.
- **Malware scanning:** select and configure a scanner/quarantine workflow
  before expanding uploads beyond the existing raster image policy. File magic
  checks reduce MIME spoofing but do not detect malware.

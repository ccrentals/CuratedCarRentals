# Bunny Storage and direct image uploads

## Purpose

Admin image uploads use a control plane on Netlify and a data plane on Bunny. Image bytes never
pass through a Netlify Function, so Netlify's effective binary request-body ceiling does not limit
the image. The application policy is 50 MiB per image.

## Request flow

1. The browser evaluates filename, MIME type, and size locally. It displays every selected file as
   `READY` or `NOT ACCEPTED` before sending image bytes.
2. The browser posts metadata and a SHA-256 checksum to
   `/api/admin/uploads/direct/authorize`.
3. Netlify verifies the operations session, CSRF token, role, destination, workflow state, and
   policy. It stores only a hash of a random, single-use token with a ten-minute expiry.
4. The browser sends one raw file at a time to the Bunny Edge Script. The script atomically claims
   the token, checks origin, byte count, MIME type, and checksum, and streams the body to the exact
   authorized Bunny Storage key. Bunny access keys exist only in Edge Script secrets.
5. The browser calls `/api/admin/uploads/direct/finalize`. Netlify verifies the recorded object and
   transactionally creates customer or inspection records. Vehicle and landing uploads return a
   public URL for the existing form save flow. Finalization is idempotent.
6. The hourly cleanup job deletes expired, failed, interrupted, or never-finalized objects. It gives
   an in-progress stream two hours and an uploaded object one hour to finalize before claiming it.
   Failed cleanup attempts remain retryable. Finalized objects are excluded.

## Supported workflows and access

- Vehicle gallery: admin or developer, including a pending/new vehicle.
- Customer legal-ID images: operations or higher; private Storage Zone.
- Pickup/return inspection images: operations or higher and only while that inspection is editable;
  private Storage Zone.
- Landing content: admin or developer.

The legacy Uploadcare path remains available when `FILE_STORAGE_PROVIDER=uploadcare`. Existing
multipart Bunny endpoints remain during rollout but the UI does not use them after cutover.

## Required configuration

Netlify:

- `FILE_STORAGE_PROVIDER=bunny`
- existing public/private Bunny zone, access-key, endpoint, and public CDN variables
- `DIRECT_IMAGE_UPLOAD_GATEWAY_URL`
- `DIRECT_IMAGE_UPLOAD_GATEWAY_SHARED_SECRET`
- existing `CRON_SECRET` and `SITE_URL`

Bunny Edge Script:

- deploy `bunny/edge-upload-gateway/index.ts`
- `APP_ORIGIN`
- `UPLOAD_ALLOWED_ORIGINS` (comma-separated exact origins; staging and production should use
  separate scripts or separately scoped secrets)
- `UPLOAD_GATEWAY_SHARED_SECRET` matching Netlify's direct-upload shared secret
- public/private Storage Zone names and access keys
- `BUNNY_STORAGE_ENDPOINT`, set to the region-specific hostname displayed on each Storage Zone's
  **FTP & API Access** page (for example, `https://ny.storage.bunnycdn.com`). Do not use the global
  `https://storage.bunnycdn.com` hostname for streamed uploads because its redirect may require
  replaying the request body.

Never expose Bunny access keys or either shared secret through a `NEXT_PUBLIC_` variable.

## Required proof before cutover

Provision and test the Edge Script in staging before enabling the new provider in production:

1. Confirm CORS preflight from the staging origin.
2. Upload 1 MiB, 6 MiB, and 49 MiB JPEG files and verify their exact stored byte counts/checksums.
3. Confirm a 51 MiB file is rejected locally before any authorization or image request.
4. Confirm operations can upload customer and inspection images; confirm an unauthenticated user
   and an invalid/locked inspection are rejected.
5. Reuse a claimed token and confirm the second request fails.
6. Interrupt an upload, let it expire, run the cleanup endpoint, and confirm no Bunny object or
   database attachment remains.
7. Retry a failed file and confirm a new token succeeds without duplicate database records.
8. Test on the Android device/browser that originally reproduced the issue.

The Edge Script documentation does not publish an inbound request-body limit. This staging proof
is therefore a release gate. If Bunny Edge cannot reliably accept a 49 MiB body, keep the same
authorization/finalization protocol and deploy the gateway on a streaming runtime with a documented
limit above 50 MiB; the browser and database design do not need to change.

## Rollout and rollback

1. Apply migration `051_direct_image_upload_sessions.sql`.
2. Deploy the app and Edge Script to staging with isolated zones/secrets.
3. Complete the proof checklist and inspect upload-session, audit, and cleanup records.
4. Deploy through GitHub to production, configure production secrets, then switch
   `FILE_STORAGE_PROVIDER=bunny`.
5. Roll back by setting `FILE_STORAGE_PROVIDER=uploadcare`. Do not remove the session table,
   cleanup job, legacy endpoints, or Edge Script until the observation window is complete.

## Operational monitoring

Alert on repeated gateway 4xx/5xx responses, sessions remaining `CLEANUP_PENDING`, checksum/size
mismatches, and finalize failures. Do not log raw tokens, shared secrets, access keys, private image
URLs, or image bodies.

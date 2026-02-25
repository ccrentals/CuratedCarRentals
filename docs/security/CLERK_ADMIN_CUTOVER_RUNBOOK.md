# Clerk Admin Cutover Runbook

## Purpose

This runbook covers the safe staged cutover from legacy admin cookie auth to Clerk-enforced admin routes.
It keeps break-glass fallback available to avoid admin lockout.

## Scope

- Admin web routes: `/admin/**`
- Admin APIs: `/api/admin/**`
- Public route exclusions kept intentionally:
  - `/admin/auth`
  - `/admin/login`
  - `/admin/set-password`
  - `/api/admin/login`

## Manual Failover Switch

- `Admin -> Settings -> Primary Admin Login Method` (DEVELOPER-only)
  - `Clerk (recommended)` => `/admin/auth` redirects to `/sign-in`
  - `Legacy (fallback)` => `/admin/auth` redirects to `/admin/login`
- Both direct routes remain valid regardless of switch value.

## Pre-Cutover Prerequisites

1. Database migration for Clerk mapping is applied (`users.clerk_user_id` exists).
2. At least one known-good break-glass admin can still sign in via legacy `/admin/login`.
3. Clerk admin/staff users exist for all active operators.
4. Local DB roles are correct (`users.role` is authoritative).
5. Clerk-to-local mapping is verified:
   - preferred: `users.clerk_user_id` populated
   - fallback: matching `users.email` confirmed
6. Preview environment has all Clerk env vars configured.
7. Rollback owner is assigned and available during rollout.

### Quick SQL Checks

```sql
-- Staff/admin users currently allowed in admin portal
select id, email, role, clerk_user_id
from users
where upper(role) in ('USER', 'ADMIN', 'DEVELOPER')
order by role, email;
```

```sql
-- Staff/admin records missing explicit Clerk mapping (email fallback still possible)
select id, email, role
from users
where upper(role) in ('USER', 'ADMIN', 'DEVELOPER')
  and (clerk_user_id is null or clerk_user_id = '')
order by role, email;
```

## Preview Cutover Steps

1. In Netlify Preview env, set `CLERK_PROTECT_ADMIN_ROUTES=1`.
2. Deploy preview build.
3. Validate happy path:
   - Clerk sign-in user with local staff role can load `/admin`.
   - Core admin APIs respond successfully (`/api/admin/me`, `/api/admin/bookings`, `/api/admin/settings`).
4. Validate deny path:
   - signed-in Clerk user without staff role gets denied (403 from guarded admin APIs).
   - signed-in Clerk user with no local mapping is denied and logs `auth.session.clerkBridgeNoLocalUser`.
5. Validate break-glass:
   - `/admin/login` still works with legacy credentials.
6. Validate password task flow:
   - Clerk `reset-password` task still routes to `/task/reset-password`.

## Production Cutover Steps

1. Choose low-risk release window with rollback owner online.
2. Confirm preview checklist passed in same release SHA.
3. Set `CLERK_PROTECT_ADMIN_ROUTES=1` in Netlify Production env.
4. Trigger production deploy.
5. Run post-cutover validations immediately (next section).

## Post-Cutover Validation Checklist

1. Staff/admin Clerk user can access `/admin`.
2. Legacy break-glass `/admin/login` still functions.
3. Admin APIs return expected authorization behavior:
   - unauthenticated -> `401`
   - non-staff mapped user -> `403`
4. No regression in non-admin flows:
   - booking creation
   - payment callback/webhooks
   - transactional emails
5. Logs reviewed for mapping issues:
   - `auth.session.clerkBridgeNoLocalUser`
   - `auth.session.clerkBridgeMappingConflict`
   - `auth.session.clerkBridgeRoleDenied`

## Rollback (Fast Path)

1. Set `CLERK_PROTECT_ADMIN_ROUTES=0` in Netlify Production env.
2. Redeploy immediately.
3. In Admin Settings, set `Primary Admin Login Method` to `Legacy (fallback)` if needed.
4. Verify legacy `/admin/login` and admin dashboard access.
5. Review rollout logs and document failure cause before reattempt.

## Break-Glass Access Strategy

- Keep legacy login during initial cutover window:
  - UI: `/admin/login`
  - API: `/api/admin/login`
- Use break-glass only when Clerk bridge fails (missing mapping, mapping conflict, or Clerk outage impacting admin access).
- After incident resolution, return to Clerk path and capture root cause.

## Legacy Auth Retirement Prerequisites

Do not remove legacy admin auth until all are true:

1. `CLERK_PROTECT_ADMIN_ROUTES=1` has run for at least one stable release cycle.
2. No break-glass usage observed during that period.
3. All active admins have verified Clerk mapping (`clerk_user_id` recommended).
4. Production incident review confirms rollback path is no longer needed.

## Future Cleanup Checklist (Separate Change)

1. Remove `/admin/login` page and `/api/admin/login` endpoint.
2. Remove legacy cookie branch from `src/lib/auth/session.ts`.
3. Remove legacy first-login password flow (`/admin/set-password`, `/api/admin/set-password`) if superseded.
4. Remove legacy-only lockout/session/CSRF branches only after usage audit confirms no shared dependencies.

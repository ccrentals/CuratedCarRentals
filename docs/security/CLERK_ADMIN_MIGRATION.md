# Clerk Admin Migration (Compatibility Bridge)

## Phase Status

- Current phase: `Compatibility bridge -> staged production cutover`
- Cutover runbook: `docs/security/CLERK_ADMIN_CUTOVER_RUNBOOK.md`
- Safety default: `CLERK_PROTECT_ADMIN_ROUTES=0` until preview/prod checklist passes

## Current State

- Legacy admin auth remains active:
  - `/admin/login`
  - `/api/admin/login`
  - signed cookie session (`ccr_admin_session`)
- Clerk admin protection is staged and opt-in:
  - `CLERK_PROTECT_ADMIN_ROUTES=0` (default)
  - set `CLERK_PROTECT_ADMIN_ROUTES=1` only after validation
- Admin APIs continue requiring server-side authorization checks.

## Primary Admin Login Method Switch (Developer-only)

- A server-side setting now controls the default admin sign-in entry path:
  - settings field: `authLoginMethod`
  - allowed values: `clerk` | `legacy`
  - default: `clerk`
- Source of truth remains DB-backed admin settings (`admin_documents.key='settings'`).
- DEVELOPER-only control lives in `Admin -> Settings`:
  - label: `Primary Admin Login Method`
  - options:
    - `Clerk (recommended)` -> defaults admin sign-in entry to `/sign-in`
    - `Legacy (fallback)` -> defaults admin sign-in entry to `/admin/login`
- Shared entry route:
  - `/admin/auth` resolves to the active primary method.
  - Header/admin sign-in entry points use `/admin/auth`.
- Safety guarantees:
  - direct `/sign-in` remains available
  - direct `/admin/login` remains available
  - non-DEVELOPER users cannot change `authLoginMethod` (API returns `403` when changed)

## Compatibility Bridge Behavior

When `CLERK_PROTECT_ADMIN_ROUTES=1`:

1. Requests to `/admin/**` and `/api/admin/**` are Clerk-protected (excluding legacy login endpoints).
2. If a valid legacy admin cookie exists, legacy session remains authoritative.
3. If no legacy cookie exists, app attempts Clerk-to-local user mapping:
   - by `users.clerk_user_id`, or
   - fallback by matching `users.email`, then auto-linking `clerk_user_id`.
4. Local DB role remains authorization source of truth (`users.role`).
5. Staff roles (`ADMIN`, `USER`, `DEVELOPER`) are required for admin access. Non-staff mapped users are denied by shared RBAC guards.
6. Bridge diagnostics are logged for operator troubleshooting:
   - `auth.session.clerkBridgeNoLocalUser`
   - `auth.session.clerkBridgeMappingConflict`
   - `auth.session.clerkBridgeRoleDenied`

## Clerk Dashboard Auth Settings (Required During Migration)

Configure these in Clerk Dashboard so `/sign-in` works for both SSO and credentials:

1. **Social providers enabled**: Apple, Google, Microsoft  
   Reason: these are intentionally exposed in the UI during migration.
2. **Sign-in identifiers path**: `Dashboard -> User & Authentication -> Email, Phone, Username`  
   Set values:
   - `Email address`: **Enabled** for sign in + sign up
   - `Phone number`: **Disabled** for sign in + sign up
   - `Username`: **Optional** (or Disabled if not needed yet)
3. **Sign-up fields path**: `Dashboard -> User & Authentication -> Sign-up`  
   Set values:
   - `Phone number`: **Not required**
   - `First name/Last name`: optional based on your policy
4. **Credential identifier policy**: prefer **email** for Clerk password sign-in  
   Reason: many legacy local usernames include `.` which Clerk usernames do not allow (`letters/numbers/-/_` only).  
   The app auto-normalizes generated Clerk usernames to supported characters.
5. **Redirect URLs**:
   - Sign in URL: `/sign-in`
   - Sign up URL: `/sign-up`
   - Post-auth fallback: `/admin`
6. **Password reset enabled** (email code strategy)  
   Reason: required for `/forgot-password` and forced reset tasks.

`/sign-up` is now an app-managed "Complete account setup" route used during migration.
It prepares/links Clerk accounts for known local staff users without requiring phone onboarding.

## New User Provisioning (Admin-Created Users)

- Sign-in UI does not show the public "Sign up" footer action.
- `/sign-up` remains available as a controlled first-time SSO recovery path during migration.
- Admins create users from `/admin/users`.
- On creation, the app now attempts Clerk provisioning for the same email and links `users.clerk_user_id` when the column exists.
- Clerk username provisioning is best-effort and derived from local username with Clerk-safe normalization.
- If Clerk sync fails, local user creation still succeeds and the UI returns a warning so support can complete linking manually.

## Prerequisites Before Enabling `CLERK_PROTECT_ADMIN_ROUTES=1`

1. Confirm all admin/staff users exist in Clerk.
2. Ensure Clerk emails match local `users.email` values, or prefill `users.clerk_user_id`.
3. Validate RBAC role mappings in local DB:
   - all intended staff/admin users have `users.role` in (`USER`, `ADMIN`, `DEVELOPER`)
   - no customer-only identities are mapped into admin users
4. Validate in Preview:
   - admin page access (`/admin`)
   - key admin APIs (`/api/admin/*`)
   - legacy admin login still works as fallback.
5. Confirm break-glass/no lockout:
   - at least one legacy admin account can still sign in via `/admin/login`.
6. Verify forced password task route:
   - pending `reset-password` task redirects to `/task/reset-password`.
7. Follow full checklist in `CLERK_ADMIN_CUTOVER_RUNBOOK.md`.

## RBAC Requirement for Cutover

Enabling Clerk admin protection (`CLERK_PROTECT_ADMIN_ROUTES=1`) is not sufficient by itself.
Admin cutover is only safe when all sensitive admin APIs are protected by shared server guards and local role checks:

- `requireStaffOrAdminRole(...)`
- `requireAdminRole(...)`
- `requireDeveloperRole(...)`

Authorization remains local-role-driven (`users.role`), even when identity comes from Clerk.

## Break-Glass + Rollback

- Break-glass path during rollout:
  - `/admin/login` + `/api/admin/login` (legacy)
- Fast rollback:
  1. set `CLERK_PROTECT_ADMIN_ROUTES=0`
  2. redeploy
  3. verify legacy admin access

## What Can Be Removed Later (After Full Cutover)

Only remove these after at least one stable release cycle with Clerk-only admin auth:

- Legacy `/admin/login` UI and `/api/admin/login` handler.
- Legacy signed cookie session logic in `src/lib/auth/session.ts` (cookie branch).
- Legacy temp-password flow (`/admin/set-password`, `/api/admin/set-password`) if no longer needed.
- Legacy lockout tables/logic tied only to the old admin password flow.

Until then, keep legacy auth as documented fallback to avoid admin lockout.

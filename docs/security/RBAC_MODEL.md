# RBAC Model

## Source of Truth

- Identity: Clerk (when Clerk-authenticated) or legacy admin session during migration.
- Authorization: local database role (`users.role`) is authoritative.
- Clerk metadata roles are optional mirrors and non-authoritative in the current design.

## Canonical Roles

Defined in `src/lib/auth/roles.ts`:

- `USER`: staff/operator access for day-to-day admin operations.
- `ADMIN`: elevated administrative access.
- `DEVELOPER`: highest operational access (developer-only controls).

Normalization is centralized via `normalizeRole()` and `parseAppRole()`.

## Access Semantics

- Staff access (`canAccessAdmin` / `staff` requirement): `USER`, `ADMIN`, `DEVELOPER`
- Admin access (`admin` requirement): `ADMIN`, `DEVELOPER`
- Developer-only (`developer` requirement): `DEVELOPER`

## Shared Server Guards

Defined in `src/lib/auth/adminGuards.ts`:

- `requireStaffOrAdminRole(...)`
- `requireAdminRole(...)`
- `requireDeveloperRole(...)`
- `resolveAdminActor(...)`

These helpers support both:

- legacy admin cookie sessions (`authSource: legacy`)
- Clerk bridge sessions (`authSource: clerk-bridge`)

Each successful guard yields a normalized actor context for audit/log readiness:

- `userId` (local user id)
- `role` / `appRole`
- `authSource`
- `clerkUserId` (when available)
- session timing fields (`issuedAt`, `expiresAt`)

## Route Boundaries

- Public routes: remain public.
- `/account/**`: customer authenticated area (Clerk protected).
- `/admin/**` and `/api/admin/**`: staff/admin area, server-side RBAC enforced via shared guards.

UI checks are supplemental only. Sensitive operations must always pass server guard checks.

## Migration Compatibility

- Legacy admin auth remains available as fallback.
- Clerk admin protection remains staged by `CLERK_PROTECT_ADMIN_ROUTES`.
- Enabling Clerk admin protection does not replace RBAC checks; local role checks still enforce authorization.

## Adding a New Role Safely

1. Add the role to canonical role definitions in `src/lib/auth/roles.ts`.
2. Define explicit access behavior in `hasRequiredAdminAccess(...)`.
3. Update guard consumers to use the intended requirement (`staff`/`admin`/`developer`).
4. Add unit tests for normalization + access predicates.
5. Update this document and `docs/security/CLERK_ADMIN_MIGRATION.md` before rollout.

## Optional Future Metadata Sync

You can mirror local roles into Clerk public/private metadata for convenience, but keep local DB roles authoritative until a deliberate cutover is designed and tested.

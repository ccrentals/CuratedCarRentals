# Admin and Public Site Separation Notes

Date: 2026-04-04

## Purpose

Capture the current architecture reality and the recommended path for eventually separating the admin portal from the public site as the platform moves toward SaaS.

## Short Answer

Yes, the admin section can be separated from the public site.

However:

- the current codebase already separates admin and public **logically**
- the current deployment does **not** separate them as different apps/sites
- the current endpoints are still part of the **same Next.js application**

So this is possible, but it would be a deliberate architecture migration rather than a simple DNS change.

## Current State

The repo already has a strong logical split:

- public routes live under `src/app/(site)`
- admin routes live under `src/app/admin`
- admin protected layout lives under `src/app/admin/(protected)/layout.tsx`
- admin shell UI lives in `src/components/admin/AdminShell.tsx`
- public APIs live under `src/app/api/public`
- admin APIs live under `src/app/api/admin`

This means the project is already organized in a way that supports a future split.

## What Is Already Separated

### Frontend route structure

- Public pages and admin pages do not share the same route tree.
- Admin uses its own shell and protected layout.
- Public pages use the site layout flow.

### API namespacing

- admin APIs are already namespaced under `/api/admin/*`
- public APIs are already namespaced under `/api/public/*`

This is good preparation for a future split.

### UI shells

- public site shell is centered around the site header/footer
- admin UI is centered around the admin shell/sidebar/header

These are already conceptually separate products.

## What Is Still Shared

Despite the route and API split, admin and public still share one application/runtime today.

### Shared deployment/runtime

They currently run inside the same Next.js app.

Examples:

- root app layout: `src/app/layout.tsx`
- shared runtime and build output
- same environment/deployment surface

### Shared auth/session model

Admin auth currently relies on shared app-side session and guard code:

- `src/lib/auth/session.ts`
- `src/lib/auth/adminGuards.ts`

This matters because moving admin to another origin or subdomain changes cookie and CSRF behavior.

### Shared database/backend logic

Both public and admin call into the same application libraries and database layer:

- `src/lib/db.ts`
- `src/lib/bookings/*`
- `src/lib/payments/*`
- `src/lib/auth/*`

### Shared same-origin API assumptions

Today the admin APIs are route handlers in the same app, not a separately deployed API service.

That means:

- the admin portal is not currently configured as a separate site talking to an independent backend
- the public site is not currently configured as a separate frontend talking to a distinct API gateway

## Are the Endpoints a Different Site Today?

No.

They are different **route namespaces**, but not a different **site/application**.

Today:

- admin endpoints are route handlers inside the same Next app
- public endpoints are route handlers inside the same Next app
- they share deployment, runtime, and server-side libraries

So the split is currently:

- **logical**

not:

- **deployment-level**

## What “Separating Admin” Could Mean

There are two different levels of separation.

### Option 1: Separate admin frontend only

Example:

- public: `www.curatedcarrentals.com`
- admin: `admin.curatedcarrentals.com`

This is the easiest and safest first step.

Possible transition:

- keep one backend for now
- move the admin frontend to its own app/subdomain
- continue using the same shared business logic until a later extraction

### Option 2: Separate admin frontend and backend/API

Example:

- public frontend: `www.curatedcarrentals.com`
- admin frontend: `admin.curatedcarrentals.com`
- API: `api.curatedcarrentals.com`

This is a deeper architectural split and would require more planning.

## What Would Need to Change for a True Split

If admin becomes a separate site/app, the main changes would be:

### Auth/session strategy

Current admin auth is based on app-side session behavior.

A separate admin site would require a clear decision on:

- shared parent-domain cookies
- token/session exchange
- Clerk-only frontend auth with backend verification

### CSRF and cross-origin behavior

Today many flows assume same-origin interaction.

A split app would require reviewing:

- CSRF token issuance
- cookie scope
- cross-origin requests
- CORS behavior

### Canonical site URL assumptions

Some flows currently rely on a single canonical site URL.

This would matter for:

- payment callbacks
- email links
- deep links
- auth redirects

### Shared application libraries

The current app already shares business logic between public and admin.

For a real split, this logic would either need to:

- remain in a shared package/library, or
- move behind a dedicated API/service layer

## Recommended Path

If the long-term direction is SaaS, the recommended path is:

### Phase 1: Separate the admin frontend

Goal:

- make admin its own app/subdomain
- keep behavior the same
- do not split the backend yet

Why:

- lowest risk
- highest product clarity
- gives cleaner public/admin separation without forcing immediate backend redesign

### Phase 2: Extract shared domain logic

Goal:

- identify business logic shared by public and admin
- make it easier to move that logic behind services or shared packages

Examples:

- auth/session contracts
- booking/payment rules
- admin/public data access boundaries

### Phase 3: Separate API/runtime if needed

Goal:

- move toward a dedicated API/backend layer only when scale or product complexity justifies it

This is the phase where:

- `api.curatedcarrentals.com`
- separate deployments
- stricter service boundaries

become worthwhile.

## Recommendation

If this project is moving toward SaaS:

- admin and public should be treated as separate products
- but they should **not** be split all at once

The best path is:

1. separate admin frontend first
2. preserve current behavior while reducing coupling
3. split API/runtime later only when needed

## Bottom Line

The codebase is already structured well enough to support a future split.

What exists today is:

- a strong **logical separation**

What does not yet exist today is:

- a true **deployment-level separation**

That means the idea is viable, but it should be approached as a staged architecture migration rather than a quick config change.

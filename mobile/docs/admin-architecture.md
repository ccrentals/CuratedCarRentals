# Native admin architecture

## Product intent

The Android app contains two intentionally separated experiences:

- the customer rental experience remains public and conversion-focused;
- the staff workspace is an authenticated operational console optimized for short, frequent mobile tasks.

The staff workspace is not a WebView and does not reproduce the desktop sidebar. It uses native routes, touch-sized controls, resilient list/detail screens, explicit destructive-action confirmation, and capability-based navigation.

## Authentication and session boundary

1. Staff sign in through Clerk in the Expo client.
2. The app sends the current Clerk session token to `POST /api/mobile/admin/session`.
3. The server validates Clerk, maps the Clerk identity to the authoritative local `users` record, and rejects inactive, locked, deactivated, or non-staff accounts.
4. The server returns a 20-minute HMAC-signed CCR token with the `native-admin` audience.
5. Admin API requests use that token in the `Authorization` header.

The CCR token stays in memory. Clerk's session is encrypted through Expo SecureStore and is used to exchange a fresh CCR token after restart or expiry. Browser-audience tokens cannot be used as native credentials. Native bearer requests do not require CSRF because they do not use ambient cookies; browser writes continue to require CSRF.

## Roles and capabilities

The local database role remains authoritative.

| Area | Operations | Admin | Developer |
| --- | --- | --- | --- |
| Dashboard, bookings, quotes, customers, calendar | Read/write | Read/write | Read/write |
| Vehicles, messages, payments, maintenance, promotions | Hidden | Read/write | Read/write |
| Reports, email activity, media | Hidden | Read | Read |
| Settings and staff users | Hidden | Read/write | Read/write |

Developer-only health, cron, template, documentation, and developer-tool routes remain desktop-only. They are high-risk engineering controls rather than mobile operational tasks. This is a deliberate product boundary, not an authorization shortcut.

The client capability map controls discoverability and UX only. Every API route continues to enforce its server-side role requirement.

## Information architecture

- **Today:** dashboard, urgent actions, arrivals/returns, balances, unread messages, vehicle readiness.
- **Work:** bookings, quotes, customers, calendar, messages.
- **Business:** vehicles, payments, maintenance, reports, promotions.
- **System:** email activity, media, settings, users, profile and sign-out.

Bottom navigation will hold the highest-frequency destinations. The complete module directory lives under **More** so the navigation remains understandable on compact Android screens.

## Shared interaction rules

- Lists provide search, filters, pull-to-refresh, loading skeletons, empty states, retry states, and pagination.
- Detail views show identity/status first, then context, timeline, financials, and actions.
- Mutations use idempotency where supported, disable duplicate submission, and refresh authoritative server state afterward.
- Destructive or financially material actions require explicit confirmation and state the consequence.
- Currency is displayed in JMD and dates use Jamaica-local operational context.
- Sensitive data is never written to logs or unencrypted local storage.
- Offline mode is read-only and limited to deliberately cached non-sensitive summaries; writes require a live server response.

## Delivery sequence

1. Secure session, role resolution, app shell, shared states, dashboard.
2. Bookings and quotes.
3. Customers and vehicles.
4. Messages and reports.
5. Settings and users.
6. Calendar, payments, maintenance, promotions, email activity, and media.
7. Security, accessibility, responsive Android, API-contract, and regression audit.

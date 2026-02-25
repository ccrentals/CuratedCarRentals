# Clerk Password Operations

## Scope

- Customer/account authentication is Clerk-first (`/sign-in`, `/sign-up`, `/forgot-password`).
- Legacy admin cookie auth still exists during migration (`/admin/login`, `/api/admin/login`).
- Clerk `reset-password` session tasks are routed to `/task/reset-password`.

## 1) Self-Service Forgot Password Flow

Path: `/forgot-password`

1. User enters their email.
2. Clerk sends a reset code (email channel configured in Clerk Dashboard).
3. User submits code + new password.
4. On success, Clerk creates a new session.
5. App calls `POST /api/public/auth/sync-legacy-password` to update local `users.password_hash`.
6. User is redirected to `/admin`.

User-facing error handling:

- Invalid or expired code: prompt user to request a new code.
- Weak password: prompt user to use a stronger password.
- Compromised password: prompt user to choose a different password.
- Generic error: show retry message.

## 2) Support/Admin Forced Reset in Clerk Dashboard

1. Open Clerk Dashboard.
2. Go to **Users** and open the target user.
3. Go to **Password** actions.
4. Use **Set password as compromised**.

This triggers a required reset on next sign-in.

## 3) What User Sees on Next Sign-In

- Clerk session is marked with task `reset-password`.
- App task routing sends the user to `/task/reset-password`.
- User must complete password reset before continuing to protected areas.
- Note: Clerk prebuilt `TaskResetPassword` does not expose plaintext password back to app code.
  Legacy hash sync is therefore guaranteed in the custom `/forgot-password` flow and best-effort
  for task-driven resets.

## 4) Troubleshooting

- No email received:
  - Verify Clerk email delivery/domain settings.
  - Check spam/junk.
  - Confirm user email in Clerk is correct and verified where required.
- Code expired/invalid:
  - Re-run `/forgot-password` and request a new code.
  - Ensure latest code is used.
- Password rejected:
  - Ensure password meets policy requirements.
  - If flagged compromised, choose a completely different password.
- Legacy login still failing after a task reset:
  - Run `/forgot-password` once to complete a synced reset path, or
  - Use admin reset action to issue a fresh temporary password.

## 5) Optional Future Enhancement (Programmatic)

If needed later, support can enforce password reset programmatically via Clerk Backend API/admin tooling:

- Set user password state as compromised, or
- Trigger an internal support action that requires the next login to complete `reset-password`.

This repo currently uses dashboard operations for forced resets to reduce operational risk.

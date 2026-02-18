"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";

type CreateUserResult = {
  ok: true;
  userId: string;
  username?: string;
  tempPassword: string;
  tempPasswordExpiresAt: string;
};

type UserRole = "USER" | "ADMIN" | "DEVELOPER";

function normalizeRole(value: string): UserRole {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "DEVELOPER") return "DEVELOPER";
  if (normalized === "ADMIN") return "ADMIN";
  return "USER";
}

function isDeveloperRole(role: string | undefined) {
  return normalizeRole(String(role ?? "")) === "DEVELOPER";
}

function mapSelectedRole(value: string, canAssignDeveloperRole: boolean): UserRole {
  const normalized = normalizeRole(value);
  if (!canAssignDeveloperRole && normalized === "DEVELOPER") {
    return "USER";
  }
  return normalized;
}

export function CreateUserForm({
  disabled,
  actorRole,
}: {
  disabled?: boolean;
  actorRole: string;
}) {
  const router = useRouter();
  const canAssignDeveloperRole = isDeveloperRole(actorRole);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("USER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<{ message: string; tone: "success" | "error" } | null>(
    null,
  );
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordExpiresAt, setTempPasswordExpiresAt] = useState<string | null>(null);
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

  function showCopyToast(message: string, tone: "success" | "error" = "success") {
    setCopyToast({ message, tone });
    window.setTimeout(() => {
      setCopyToast((current) => (current?.message === message ? null : current));
    }, 1600);
  }

  async function submit() {
    if (disabled) return;
    if (loading) return;
    setLoading(true);
    setError(null);
    setCopyToast(null);
    setTempPassword(null);
    setTempPasswordExpiresAt(null);
    setCreatedUsername(null);

    if (firstName.trim().length < 1) {
      setError("First name is required.");
      setLoading(false);
      return;
    }

    if (lastName.trim().length < 1) {
      setError("Last name is required.");
      setLoading(false);
      return;
    }

    if (!email.trim() || !email.includes("@")) {
      setError("A valid email is required.");
      setLoading(false);
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        role,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as Partial<CreateUserResult> & {
      error?: string;
    };

    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Unable to create user.");
      return;
    }

    if (!data.tempPassword) {
      setError("User created, but the temporary password was not returned.");
      router.refresh();
      return;
    }

    setTempPassword(data.tempPassword);
    setTempPasswordExpiresAt(data.tempPasswordExpiresAt ?? null);
    setCreatedUsername(data.username ? String(data.username) : null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("USER");
    router.refresh();
  }

  return (
    <div className="mt-6">
      <SlideDownPanel
        title="Create user"
        description="Creates an account with a temporary password (expires in 3 days). The user will be prompted to set a permanent password after first login."
        defaultOpen={false}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-[var(--ccr-muted)]">
            First name
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={disabled || loading}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Last name
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={disabled || loading}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled || loading}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Role
            <select
              value={role}
              onChange={(e) => setRole(mapSelectedRole(e.target.value, canAssignDeveloperRole))}
              disabled={disabled || loading}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
              {canAssignDeveloperRole ? <option value="DEVELOPER">DEVELOPER</option> : null}
            </select>
          </label>
        </div>

        {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={disabled || loading}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create user"}
          </button>
        </div>

        {tempPassword ? (
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] p-4 text-sm text-[var(--ccr-text)]">
            <p className="font-semibold text-[var(--ccr-text)]">Temporary password created</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Share this password securely with the user. It is shown once and will expire in 3 days.
            </p>
            {createdUsername ? (
              <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                Username:{" "}
                <span className="font-mono text-[var(--ccr-text)]">{createdUsername}</span>
              </p>
            ) : null}
            <p className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 font-mono text-sm text-[var(--ccr-text)]">
              {tempPassword}
            </p>
            {tempPasswordExpiresAt ? (
              <p className="mt-2 text-[11px] text-[var(--ccr-muted)]">
                Expires: {new Date(tempPasswordExpiresAt).toLocaleString()}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(tempPassword);
                    showCopyToast("Copied", "success");
                  } catch {
                    showCopyToast("Copy failed", "error");
                  }
                }}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-bg)]"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  setTempPassword(null);
                  setTempPasswordExpiresAt(null);
                  setCreatedUsername(null);
                  setCopyToast(null);
                }}
                aria-label="Dismiss temporary password"
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-bg)]"
              >
                X
              </button>
              {copyToast ? (
                <span
                  className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                    copyToast.tone === "success"
                      ? "border-[var(--ccr-accent)] bg-[var(--ccr-bg)] text-[var(--ccr-accent)]"
                      : "border-red-400/40 bg-[var(--ccr-bg)] text-red-200"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {copyToast.message}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </SlideDownPanel>
    </div>
  );
}

type UserRowActionsProps = {
  currentUserId: string;
  userId: string;
  email: string;
  fullName?: string | null;
  username?: string | null;
  role: string;
  actorRole: string;
  isActive?: boolean | null;
  deactivatedAt?: string | null;
  lockedAt?: string | null;
};

type ResetResult = { tempPassword: string; tempPasswordExpiresAt?: string | null };

type Mode =
  | "edit_profile"
  | "set_role"
  | "deactivate"
  | "reactivate"
  | "unlock"
  | "lock"
  | "reset_password"
  | null;

function ActionIconButton({
  label,
  title,
  onClick,
  disabled,
  className = "",
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={`rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-2 text-[var(--ccr-text)] hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-bg)] disabled:opacity-60 ${className}`}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  );
}

export function UserRowActions({
  currentUserId,
  userId,
  email,
  fullName,
  username,
  role,
  actorRole,
  isActive,
  deactivatedAt,
  lockedAt,
}: UserRowActionsProps) {
  const router = useRouter();
  const canAssignDeveloperRole = isDeveloperRole(actorRole);
  const currentRole = normalizeRole(role);
  const [mode, setMode] = useState<Mode>(null);
  const [nextRole, setNextRole] = useState<UserRole>(currentRole);
  const [reason, setReason] = useState("");
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [editFullName, setEditFullName] = useState((fullName ?? "").trim() || email);
  const [editEmail, setEditEmail] = useState(email);
  const [editUsername, setEditUsername] = useState((username ?? "").trim());
  const [copyToast, setCopyToast] = useState<null | "Copied" | "Copy failed">(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeactivated = isActive === false || Boolean(deactivatedAt);
  const self = currentUserId === userId;
  const isLocked = Boolean(lockedAt);
  const canEditRole = canAssignDeveloperRole || currentRole !== "DEVELOPER";

  const title = useMemo(() => {
    if (mode === "edit_profile") return "Edit user";
    if (mode === "set_role") return "Change role";
    if (mode === "deactivate") return "Deactivate user";
    if (mode === "reactivate") return "Reactivate user";
    if (mode === "unlock") return "Unlock account";
    if (mode === "lock") return "Lock account";
    if (mode === "reset_password") return "Reset password";
    return "";
  }, [mode]);

  async function patch(payload: Record<string, unknown>) {
    const csrfToken = await ensureCsrfToken();
    return fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify(payload),
    });
  }

  async function submit() {
    if (!mode || loading) return;
    setLoading(true);
    setError(null);

    if (mode === "edit_profile") {
      if (editFullName.trim().length < 2) {
        setError("Name is required.");
        setLoading(false);
        return;
      }
      if (!editEmail.trim() || !editEmail.includes("@")) {
        setError("A valid email is required.");
        setLoading(false);
        return;
      }
      if (editUsername.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        setLoading(false);
        return;
      }
    }

    if (
      (mode === "deactivate" ||
        mode === "reactivate" ||
        mode === "reset_password" ||
        mode === "lock") &&
      !reason.trim()
    ) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    const payload =
      mode === "edit_profile"
        ? {
            action: "update_profile",
            fullName: editFullName.trim(),
            email: editEmail.trim(),
            username: editUsername.trim(),
          }
        : mode === "set_role"
        ? { action: "set_role", role: nextRole }
        : mode === "deactivate"
          ? { action: "deactivate", reason: reason.trim() }
          : mode === "reactivate"
            ? { action: "reactivate", reason: reason.trim() }
            : mode === "unlock"
              ? { action: "unlock", reason: reason.trim() || undefined }
              : mode === "lock"
                ? { action: "lock", reason: reason.trim() }
              : { action: "reset_password", reason: reason.trim() };

    const response = await patch(payload);
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      tempPassword?: string;
      tempPasswordExpiresAt?: string;
    };

    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? data.message ?? "Action failed.");
      return;
    }

    if (mode === "reset_password") {
      if (!data.tempPassword) {
        setError("Password reset succeeded, but temporary password was not returned.");
        return;
      }
      setResetResult({
        tempPassword: data.tempPassword,
        tempPasswordExpiresAt: data.tempPasswordExpiresAt ?? null,
      });
      setReason("");
      router.refresh();
      return;
    }

    setMode(null);
    setReason("");
    setResetResult(null);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canEditRole ? (
        <ActionIconButton
          label="Edit user"
          title="Edit user"
          onClick={() => {
            setError(null);
            setResetResult(null);
            setCopyToast(null);
            setEditFullName((fullName ?? "").trim() || email);
            setEditEmail(email);
            setEditUsername((username ?? "").trim());
            setMode("edit_profile");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </ActionIconButton>
      ) : null}

      {canEditRole ? (
        <ActionIconButton
          label="Change role"
          title="Change role"
          onClick={() => {
            setError(null);
            setNextRole(currentRole);
            setMode("set_role");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l7 4v5c0 5-3.5 7.7-7 9-3.5-1.3-7-4-7-9V7l7-4z" />
            <path d="M9.5 12.5l2 2 3-3" />
          </svg>
        </ActionIconButton>
      ) : null}

      {isLocked ? (
        <ActionIconButton
          label="Unlock account"
          title="Unlock account"
          onClick={() => {
            setError(null);
            setReason("");
            setResetResult(null);
            setMode("unlock");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V8a5 5 0 0 1 9.9-1" />
          </svg>
        </ActionIconButton>
      ) : null}

      {!isLocked && !isDeactivated ? (
        <ActionIconButton
          label="Lock account"
          title={self ? "You cannot lock your own account." : "Lock account"}
          onClick={() => {
            if (self) return;
            setError(null);
            setReason("");
            setResetResult(null);
            setMode("lock");
          }}
          disabled={self}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V8a5 5 0 0 1 10 0v3" />
          </svg>
        </ActionIconButton>
      ) : null}

      <ActionIconButton
        label="Reset password"
        title={self ? "You cannot reset your own password here." : "Reset password"}
        onClick={() => {
          if (self) return;
          setError(null);
          setReason("");
          setResetResult(null);
          setCopyToast(null);
          setMode("reset_password");
        }}
        disabled={self}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 11a8 8 0 1 0-2.34 5.66" />
          <path d="M20 4v7h-7" />
        </svg>
      </ActionIconButton>

      {isDeactivated ? (
        <ActionIconButton
          label="Reactivate user"
          title="Reactivate user"
          onClick={() => {
            setError(null);
            setReason("");
            setMode("reactivate");
          }}
          className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/60"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 11a8 8 0 1 0-2.34 5.66" />
            <path d="M20 4v7h-7" />
          </svg>
        </ActionIconButton>
      ) : (
        <ActionIconButton
          label="Deactivate user"
          title={self ? "You cannot deactivate your own account." : "Deactivate user"}
          onClick={() => {
            if (self) return;
            setError(null);
            setReason("");
            setMode("deactivate");
          }}
          disabled={self}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M18 8l4 4M22 8l-4 4" />
          </svg>
        </ActionIconButton>
      )}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              if (loading) return;
              setMode(null);
              setError(null);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--ccr-text)]">{title}</h3>
            <p className="mt-1 text-sm text-[var(--ccr-muted)] break-all">
              {email}
            </p>

            {mode === "edit_profile" ? (
              <div className="mt-4 grid gap-3">
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Name
                  <input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Email
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Username
                  <input
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </div>
            ) : mode === "set_role" ? (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                Role
                <select
                  value={nextRole}
                  onChange={(e) => setNextRole(mapSelectedRole(e.target.value, canAssignDeveloperRole))}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                  {canAssignDeveloperRole ? <option value="DEVELOPER">DEVELOPER</option> : null}
                </select>
              </label>
            ) : mode === "unlock" ? (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                Note (optional)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            ) : mode === "lock" ? (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                Reason (required)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            ) : mode === "reset_password" && resetResult ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-[var(--ccr-muted)]">
                  Temporary password created. It expires in 3 days and the user will be required to set a permanent password after logging in.
                </p>
                <p className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 font-mono text-sm text-[var(--ccr-text)]">
                  {resetResult.tempPassword}
                </p>
                {resetResult.tempPasswordExpiresAt ? (
                  <p className="text-[11px] text-[var(--ccr-muted)]">
                    Expires: {new Date(resetResult.tempPasswordExpiresAt).toLocaleString()}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(resetResult.tempPassword);
                        setCopyToast("Copied");
                        window.setTimeout(() => setCopyToast(null), 1400);
                      } catch {
                        setCopyToast("Copy failed");
                        window.setTimeout(() => setCopyToast(null), 1400);
                      }
                    }}
                    className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-bg)]"
                  >
                    Copy
                  </button>
                  {copyToast ? (
                    <span
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                        copyToast === "Copied"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-bg)] text-[var(--ccr-accent)]"
                          : "border-red-400/40 bg-[var(--ccr-bg)] text-red-200"
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      {copyToast}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                Reason (required)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            )}

            {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (loading) return;
                  setMode(null);
                  setError(null);
                }}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
              >
                  {mode === "reset_password" && resetResult ? "Done" : "Cancel"}
                </button>
              {mode === "reset_password" && resetResult ? null : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={loading}
                  className="rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {loading ? "Saving..." : "Confirm"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

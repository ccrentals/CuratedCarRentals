"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";
import { buttonStyles } from "@/components/ui/Button";

type CreateUserResult = {
  ok: true;
  userId: string;
  username: string;
  tempPassword: string;
  tempPasswordExpiresAt: string;
  clerkSync?:
    | {
        status: "created" | "linked_existing";
        clerkUserId: string;
        message: string;
        localLinkSaved: boolean;
        localLinkWarning?: string;
      }
    | {
        status: "skipped" | "failed";
        clerkUserId: null;
        message: string;
      };
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
  const [showTempPassword, setShowTempPassword] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [successNotice, setSuccessNotice] = useState<{
    tempPassword: string;
    tempPasswordExpiresAt: string | null;
    createdUsername: string | null;
    clerkMessage: string | null;
    clerkWarning: string | null;
    clerkWarningDetail: string | null;
  } | null>(null);

  function showCopyToast(message: string, tone: "success" | "error" = "success") {
    setCopyToast({ message, tone });
    window.setTimeout(() => {
      setCopyToast((current) => (current?.message === message ? null : current));
    }, 1600);
  }

  function dismissSuccessNotice() {
    setSuccessNotice(null);
    setShowTempPassword(true);
    setCopyToast(null);
  }

  async function submit() {
    if (disabled) return;
    if (loading) return;
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    setCopyToast(null);

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

    if (!data.username) {
      setError("User created, but the username was not returned.");
      router.refresh();
      return;
    }

    setShowTempPassword(true);
    setSuccessNotice({
      tempPassword: data.tempPassword,
      tempPasswordExpiresAt: data.tempPasswordExpiresAt ?? null,
      createdUsername: String(data.username),
      clerkMessage:
        data.clerkSync && "message" in data.clerkSync ? data.clerkSync.message : null,
      clerkWarning:
        data.clerkSync &&
        "status" in data.clerkSync &&
        (data.clerkSync.status === "failed" ||
          data.clerkSync.status === "skipped" ||
          ("localLinkSaved" in data.clerkSync && !data.clerkSync.localLinkSaved))
          ? "Clerk link needs attention."
          : "Clerk link ready.",
      clerkWarningDetail:
        data.clerkSync && "localLinkWarning" in data.clerkSync
          ? (data.clerkSync.localLinkWarning ?? null)
          : null,
    });
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("USER");
    setPanelOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-6" data-testid="create-user-section">
      <SlideDownPanel
        title="Create user"
        description="Creates an account with a temporary password (expires in 3 days). The user will be prompted to set a permanent password after first login."
        defaultOpen={false}
        open={panelOpen}
        onOpenChange={setPanelOpen}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-[var(--ccr-muted)]">
            First name
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={disabled || loading}
              data-testid="create-user-first-name"
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Last name
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={disabled || loading}
              data-testid="create-user-last-name"
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled || loading}
              data-testid="create-user-email"
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
            />
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Role
            <select
              value={role}
              onChange={(e) => setRole(mapSelectedRole(e.target.value, canAssignDeveloperRole))}
              disabled={disabled || loading}
              data-testid="create-user-role"
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
            data-testid="create-user-submit"
            className={buttonStyles({ variant: "primary", size: "md" })}
          >
            {loading ? "Creating..." : "Create user"}
          </button>
        </div>
      </SlideDownPanel>

      {successNotice ? (
        <div
          className="relative mt-3 rounded-xl border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] p-3 pr-14 text-xs text-[var(--ccr-text)]"
          data-testid="create-user-success-panel"
        >
          <button
            type="button"
            aria-label="Close user created notice"
            onClick={dismissSuccessNotice}
            className={buttonStyles({
              variant: "ghost",
              size: "xs",
              className:
                "absolute right-3 top-3 rounded-lg px-2 text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]",
            })}
          >
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
          </button>
          <p className="font-semibold text-[var(--ccr-text)]">User created successfully.</p>
          <p className="mt-1 text-[11px] text-[var(--ccr-muted)]">
            Save this now - it won&apos;t be shown again.
          </p>
          {successNotice.createdUsername ? (
            <p className="mt-2 text-[11px] text-[var(--ccr-muted)]">
              Username:{" "}
              <span
                className="font-mono text-[var(--ccr-text)]"
                data-testid="create-user-success-username"
              >
                {successNotice.createdUsername}
              </span>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="create-user-temp-password">
              Temporary password
            </label>
            <input
              id="create-user-temp-password"
              type={showTempPassword ? "text" : "password"}
              value={successNotice.tempPassword}
              readOnly
              data-testid="create-user-success-temp-password"
              className="min-w-[16rem] flex-1 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 font-mono text-xs text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={() => setShowTempPassword((current) => !current)}
              className={buttonStyles({ variant: "secondary", size: "xs" })}
              data-testid="create-user-toggle-password-visibility"
            >
              {showTempPassword ? "Hide" : "Show"}
            </button>
          </div>
          {successNotice.tempPasswordExpiresAt ? (
            <p className="mt-1 text-[11px] text-[var(--ccr-muted)]">
              Password expires:{" "}
              <DateTimeInline
                value={successNotice.tempPasswordExpiresAt}
                className="inline-flex"
              />
            </p>
          ) : null}
          {successNotice.clerkMessage ? (
            <p
              className={`mt-1 text-[11px] ${
                successNotice.clerkWarning === "Clerk link needs attention."
                  ? "text-amber-300"
                  : "text-emerald-300"
              }`}
            >
              {successNotice.clerkMessage}
            </p>
          ) : null}
          {successNotice.clerkWarningDetail ? (
            <p className="mt-1 text-[11px] text-amber-300">{successNotice.clerkWarningDetail}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(successNotice.tempPassword);
                  showCopyToast("Copied", "success");
                } catch {
                  showCopyToast("Copy failed", "error");
                }
              }}
              className={buttonStyles({ variant: "secondary", size: "xs" })}
              data-testid="create-user-copy-temp-password"
            >
              Copy temp password
            </button>
            <button
              type="button"
              onClick={() => {
                dismissSuccessNotice();
                setPanelOpen(true);
              }}
              className={buttonStyles({ variant: "secondary", size: "xs" })}
            >
              Create another
            </button>
            <button
              type="button"
              aria-label="Dismiss user created notice"
              onClick={dismissSuccessNotice}
              className={buttonStyles({ variant: "secondary", size: "xs" })}
            >
              Dismiss
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

type ResetResult =
  | {
      kind: "temp";
      tempPassword: string;
      tempPasswordExpiresAt?: string | null;
    }
  | {
      kind: "self";
      message: string;
    };

type Mode =
  | "edit_profile"
  | "set_role"
  | "deactivate"
  | "reactivate"
  | "unlock"
  | "lock"
  | "delete_user"
  | "reset_password"
  | null;

const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      className={buttonStyles({
        variant: "secondary",
        size: "xs",
        className: `rounded-lg p-2 ${className}`,
      })}
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
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [copyToast, setCopyToast] = useState<null | "Copied" | "Copy failed">(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalPanelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const isDeactivated = isActive === false || Boolean(deactivatedAt);
  const self = currentUserId === userId;
  const isLocked = Boolean(lockedAt);
  const canEditRole = canAssignDeveloperRole || currentRole !== "DEVELOPER";
  const canDeleteUser = !self && canEditRole;

  const title = useMemo(() => {
    if (mode === "edit_profile") return "Edit user";
    if (mode === "set_role") return "Change role";
    if (mode === "deactivate") return "Deactivate user";
    if (mode === "reactivate") return "Reactivate user";
    if (mode === "unlock") return "Unlock account";
    if (mode === "lock") return "Lock account";
    if (mode === "delete_user") return "Delete user";
    if (mode === "reset_password") return "Reset password";
    return "";
  }, [mode]);
  const titleId = `user-action-title-${userId}`;

  const rememberFocusedTrigger = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      restoreFocusRef.current = active;
    }
  }, []);

  const openMode = useCallback(
    (nextMode: Exclude<Mode, null>) => {
      rememberFocusedTrigger();
      setMode(nextMode);
    },
    [rememberFocusedTrigger],
  );

  const closeModal = useCallback(() => {
    if (loading) return;
    setMode(null);
    setError(null);
    setDeleteConfirmation("");
  }, [loading]);

  useEffect(() => {
    if (!mode) return;
    const panel = modalPanelRef.current;
    if (!panel) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const rafId = window.requestAnimationFrame(() => {
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
      (focusable[0] ?? panel).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!modalPanelRef.current) return;
      const currentPanel = modalPanelRef.current;

      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(currentPanel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
      );

      if (focusable.length === 0) {
        event.preventDefault();
        currentPanel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !currentPanel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !currentPanel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget && document.contains(restoreTarget)) {
        restoreTarget.focus();
      }
      restoreFocusRef.current = null;
    };
  }, [closeModal, mode]);

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
        mode === "lock" ||
        mode === "delete_user") &&
      !reason.trim()
    ) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    if (mode === "delete_user") {
      const typedConfirmation = deleteConfirmation.trim().toLowerCase();
      const expectedConfirmation = email.trim().toLowerCase();
      if (!typedConfirmation) {
        setError("Type the user's email to confirm deletion.");
        setLoading(false);
        return;
      }
      if (typedConfirmation !== expectedConfirmation) {
        setError("Email confirmation does not match this user.");
        setLoading(false);
        return;
      }
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
                : mode === "delete_user"
                  ? { action: "delete_user", reason: reason.trim() }
                  : { action: "reset_password", reason: reason.trim() };

    const response = await patch(payload);
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      tempPassword?: string;
      tempPasswordExpiresAt?: string;
      selfReset?: boolean;
    };

    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? data.message ?? "Action failed.");
      return;
    }

    if (mode === "reset_password") {
      if (data.tempPassword) {
        setResetResult({
          kind: "temp",
          tempPassword: data.tempPassword,
          tempPasswordExpiresAt: data.tempPasswordExpiresAt ?? null,
        });
      } else if (data.selfReset) {
        setResetResult({
          kind: "self",
          message:
            data.message ??
            "Password reset initiated. You will be signed out and prompted to set a new password.",
        });
      } else {
        setError("Password reset succeeded, but temporary password was not returned.");
        return;
      }
      setReason("");
      router.refresh();
      return;
    }

    setMode(null);
    setReason("");
    setDeleteConfirmation("");
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
            openMode("edit_profile");
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
            openMode("set_role");
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
            openMode("unlock");
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
            openMode("lock");
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
        title="Reset password"
        onClick={() => {
          setError(null);
          setReason("");
          setResetResult(null);
          setCopyToast(null);
          openMode("reset_password");
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
            openMode("reactivate");
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
            openMode("deactivate");
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

      <ActionIconButton
        label="Delete user"
        title={
          self
            ? "You cannot delete your own account."
            : canDeleteUser
              ? "Delete user"
              : "Only developers can delete developer accounts."
        }
        onClick={() => {
          if (!canDeleteUser) return;
          setError(null);
          setReason("");
          setDeleteConfirmation("");
          setResetResult(null);
          setCopyToast(null);
          openMode("delete_user");
        }}
        disabled={!canDeleteUser}
        className="border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] text-[var(--ccr-clerk-danger-text)] hover:opacity-90"
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
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </ActionIconButton>

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button
            type="button"
            aria-label="Close user action dialog"
            className="absolute inset-0 bg-black/60"
            onClick={closeModal}
          />
          <div
            ref={modalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 flex max-h-[85vh] w-[92vw] max-w-md min-w-0 flex-col overflow-x-hidden rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-2xl sm:w-full sm:p-5"
            tabIndex={-1}
          >
            <h3 id={titleId} className="min-w-0 text-lg font-bold text-[var(--ccr-text)]">
              {title}
            </h3>
            <p className="mt-1 break-words text-sm text-[var(--ccr-muted)]">{email}</p>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {mode === "edit_profile" ? (
                <div className="grid gap-3">
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
                <label className="block text-xs text-[var(--ccr-muted)]">
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
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Note (optional)
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              ) : mode === "lock" ? (
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Reason (required)
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              ) : mode === "delete_user" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] px-3 py-3 text-sm text-[var(--ccr-clerk-danger-text)]">
                    This permanently removes the user account. Audit details are retained, but the user record itself is deleted and cannot be restored from this screen.
                  </div>
                  <label className="block text-xs text-[var(--ccr-muted)]">
                    Reason (required)
                    <textarea
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setError(null);
                      }}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="block text-xs text-[var(--ccr-muted)]">
                    Type the user&apos;s email to confirm
                    <input
                      value={deleteConfirmation}
                      onChange={(e) => {
                        setDeleteConfirmation(e.target.value);
                        setError(null);
                      }}
                      placeholder={email}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </div>
              ) : mode === "reset_password" && resetResult ? (
                <div className="space-y-3">
                  {resetResult.kind === "temp" ? (
                    <>
                      <p className="text-sm text-[var(--ccr-muted)]">
                        Temporary password created. It expires in 3 days and the user will be required to set a permanent password after logging in.
                      </p>
                      <p className="break-all rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 font-mono text-sm text-[var(--ccr-text)]">
                        {resetResult.tempPassword}
                      </p>
                      {resetResult.tempPasswordExpiresAt ? (
                        <p className="text-[11px] text-[var(--ccr-muted)]">
                          Expires:{" "}
                          <DateTimeInline
                            value={resetResult.tempPasswordExpiresAt}
                            className="inline-flex"
                          />
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
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ccr-muted)]">{resetResult.message}</p>
                  )}
                </div>
              ) : (
                <label className="block text-xs text-[var(--ccr-muted)]">
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
            </div>

            <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--ccr-border)] pt-3">
              <button
                type="button"
                onClick={closeModal}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                {mode === "reset_password" && resetResult ? "Done" : "Cancel"}
              </button>
              {mode === "reset_password" && resetResult ? null : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={loading}
                  className={buttonStyles({
                    variant: mode === "delete_user" ? "danger" : "primary",
                    size: "sm",
                  })}
                >
                  {loading ? (mode === "delete_user" ? "Deleting..." : "Saving...") : mode === "delete_user" ? "Delete user" : "Confirm"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

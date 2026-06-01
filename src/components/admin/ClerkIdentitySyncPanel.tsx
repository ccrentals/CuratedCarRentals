"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClerkIdentitySyncReport } from "@/lib/auth/clerkIdentitySync";
import { fmtAdminDateTimeNoSeconds } from "@/lib/dateFormat";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

export function ClerkIdentitySyncPanel({
  initialReport,
}: {
  initialReport: ClerkIdentitySyncReport;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit(body: Record<string, unknown>, token: string) {
    const response = await fetch("/api/admin/developer/auth-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ ...body, csrfToken: token }),
    });

    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
    if (!response.ok || data.ok === false) {
      throw new Error(data.error ?? data.message ?? "Request failed.");
    }
    return data.message ?? "Sync completed.";
  }

  async function repairAllSafe() {
    if (submitting) return;
    setSubmitting("repair_all_safe");
    setMessage(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const resultMessage = await submit({ action: "repair_all_safe" }, csrfToken ?? "");
      setMessage({ tone: "success", text: resultMessage });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Repair failed." });
    } finally {
      setSubmitting(null);
    }
  }

  async function repairRow(localUserId: string | null, clerkUserId: string | null) {
    if (submitting) return;
    const actionKey = localUserId || clerkUserId || "repair_user";
    setSubmitting(actionKey);
    setMessage(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const resultMessage = await submit(
        { action: "repair_user", localUserId, clerkUserId },
        csrfToken ?? "",
      );
      setMessage({ tone: "success", text: resultMessage });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Repair failed." });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Clerk identity sync</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Clerk is the identity source of truth. This report shows local drift and safe repair options.
          </p>
          <p className="mt-2 text-xs text-[var(--ccr-muted)]">
            Generated: {fmtAdminDateTimeNoSeconds(initialReport.generatedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => repairAllSafe()}
          disabled={Boolean(submitting) || !initialReport.clerkAvailable}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {submitting === "repair_all_safe" ? "Repairing..." : "Repair all safe"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {Object.entries(initialReport.counts).map(([status, count]) => (
          <span
            key={status}
            className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 font-semibold text-[var(--ccr-text)]"
          >
            {status.replaceAll("_", " ")}: {count}
          </span>
        ))}
      </div>

      {message ? (
        <p className={`mt-4 text-sm ${message.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
          {message.text}
        </p>
      ) : null}

      {initialReport.rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ccr-muted)]">No users were available for Clerk sync reporting.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Local</th>
                <th className="px-3 py-3">Clerk</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {initialReport.rows.map((row) => {
                const actionKey = row.localUserId || row.clerkUserId || row.status;
                return (
                  <tr key={`${row.status}-${row.localUserId ?? "none"}-${row.clerkUserId ?? "none"}`} className="border-b border-[var(--ccr-border)] align-top last:border-b-0">
                    <td className="px-3 py-3 font-semibold text-[var(--ccr-text)]">{row.status.replaceAll("_", " ")}</td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">
                      <div>{row.localEmail ?? "—"}</div>
                      <div className="text-xs text-[var(--ccr-muted)]">
                        {row.localUsername ?? "—"}{row.localRole ? ` · ${row.localRole}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">
                      <div>{row.clerkEmail ?? "—"}</div>
                      <div className="text-xs text-[var(--ccr-muted)]">{row.clerkUsername ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-[var(--ccr-muted)]">{row.reason}</td>
                    <td className="px-3 py-3 text-right">
                      {row.canAutoRepair ? (
                        <button
                          type="button"
                          onClick={() => repairRow(row.localUserId, row.clerkUserId)}
                          disabled={Boolean(submitting)}
                          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                        >
                          {submitting === actionKey ? "Repairing..." : "Repair"}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--ccr-muted)]">Manual</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

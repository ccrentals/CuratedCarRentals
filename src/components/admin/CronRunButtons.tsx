"use client";

import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type RunState = "idle" | "running" | "success" | "error";

async function runCron(path: string) {
  const csrfToken = await ensureCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error ?? "Failed to run cron");
  }
  return data;
}

export function CronRunButtons() {
  const [pickupState, setPickupState] = useState<RunState>("idle");
  const [balanceState, setBalanceState] = useState<RunState>("idle");
  const [notesState, setNotesState] = useState<RunState>("idle");
  const [maintenanceState, setMaintenanceState] = useState<RunState>("idle");
  const [simulateState, setSimulateState] = useState<RunState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (
    type: "pickup" | "balance" | "notes" | "maintenance" | "simulate",
    path: string,
    setState: (state: RunState) => void,
  ) => {
    setMessage(null);
    setError(null);
    setState("running");
    try {
      const data = await runCron(path);
      setState("success");
      if (type === "notes") {
        setMessage(
          `Scheduled note emails ran. Due ${data?.dueNotes ?? 0}, sent ${data?.emailsSent ?? 0}, failures ${
            data?.emailFailures ?? 0
          }.`,
        );
      } else if (type === "simulate") {
        setMessage(
          `Reminder simulation ran. Logged ${data?.simulatedEvents ?? 0} simulated events for mode ${
            data?.mode ?? "all"
          }.`,
        );
      } else if (type === "maintenance") {
        setMessage(
          `Maintenance reminders ran. Due schedules ${data?.dueSchedules ?? 0}, created ${
            data?.remindersCreated ?? 0
          }, skipped ${data?.remindersSkipped ?? 0}.`,
        );
      } else {
        setMessage(
          `${type === "pickup" ? "Pickup" : "Balance"} reminder ran. Sent ${
            data?.sent ?? 0
          }, skipped ${data?.skipped ?? 0}.`,
        );
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to run cron");
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Run Reminder Jobs
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              handleRun(
                "pickup",
                "/api/admin/cron/run-pickup-reminders",
                setPickupState,
              )
            }
            disabled={pickupState === "running"}
            className={buttonStyles({
              variant: "secondary",
              size: "sm",
              className: "w-full justify-center",
            })}
          >
            {pickupState === "running" ? "Running..." : "Run Pickup Reminders"}
          </button>
          <button
            type="button"
            onClick={() =>
              handleRun(
                "balance",
                "/api/admin/cron/run-balance-reminders",
                setBalanceState,
              )
            }
            disabled={balanceState === "running"}
            className={buttonStyles({
              variant: "secondary",
              size: "sm",
              className: "w-full justify-center",
            })}
          >
            {balanceState === "running" ? "Running..." : "Run Balance Reminders"}
          </button>
          <button
            type="button"
            onClick={() =>
              handleRun(
                "notes",
                "/api/admin/cron/run-note-emails",
                setNotesState,
              )
            }
            disabled={notesState === "running"}
            className={buttonStyles({
              variant: "secondary",
              size: "sm",
              className: "w-full justify-center",
            })}
          >
            {notesState === "running" ? "Running..." : "Run Scheduled Notes"}
          </button>
          <button
            type="button"
            onClick={() =>
              handleRun(
                "maintenance",
                "/api/admin/cron/run-maintenance-reminders",
                setMaintenanceState,
              )
            }
            disabled={maintenanceState === "running"}
            className={buttonStyles({
              variant: "secondary",
              size: "sm",
              className: "w-full justify-center",
            })}
          >
            {maintenanceState === "running" ? "Running..." : "Run Maintenance Reminders"}
          </button>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Diagnostics
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              handleRun(
                "simulate",
                "/api/admin/cron/simulate-reminders",
                setSimulateState,
              )
            }
            disabled={simulateState === "running"}
            className={buttonStyles({ variant: "outline", size: "sm" })}
          >
            {simulateState === "running" ? "Running..." : "Simulate Reminder Logs"}
          </button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

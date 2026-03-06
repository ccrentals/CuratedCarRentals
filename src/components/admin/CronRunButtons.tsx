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
    <div className="mt-4 flex flex-wrap gap-3">
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
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {pickupState === "running" ? "Running..." : "Run Pickup Reminder Now"}
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
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {balanceState === "running" ? "Running..." : "Run Balance Reminder Now"}
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
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {notesState === "running" ? "Running..." : "Run Scheduled Note Emails Now"}
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
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {maintenanceState === "running" ? "Running..." : "Run Maintenance Reminders Now"}
      </button>
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
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {simulateState === "running" ? "Running..." : "Simulate Reminder Logs"}
      </button>
      {message ? <p className="w-full text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="w-full text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

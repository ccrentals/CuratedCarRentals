"use client";

import { useEffect, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

import { UploadcareImagesInput } from "./UploadcareImagesInput";

export function AdminVehicleForm() {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const csrfReady = Boolean(csrfToken);

  useEffect(() => {
    let active = true;
    ensureCsrfToken()
      .then((token) => {
        if (active) setCsrfToken(token);
      })
      .catch(() => {
        if (active) setCsrfToken(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <form className="mt-4 grid gap-4 md:grid-cols-2" action="/api/admin/vehicles" method="POST">
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <label className="text-sm text-[var(--ccr-muted)]">
        Make
        <input
          name="make"
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        />
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Model
        <input
          name="model"
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        />
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Year
        <input
          name="year"
          type="number"
          min="1990"
          max={new Date().getFullYear() + 1}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        />
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Daily Rate (JMD)
        <input
          name="daily_rate_jmd"
          type="number"
          min="0"
          step="0.01"
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        />
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Deposit (JMD)
        <input
          name="deposit_jmd"
          type="number"
          min="0"
          step="0.01"
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        />
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Status
        <select
          name="status"
          defaultValue="AVAILABLE"
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        >
          <option value="AVAILABLE">AVAILABLE</option>
          <option value="UNAVAILABLE">UNAVAILABLE</option>
          <option value="RESERVED">RESERVED</option>
          <option value="RENTED">RENTED</option>
          <option value="MAINTENANCE">MAINTENANCE</option>
        </select>
      </label>
      <label className="text-sm text-[var(--ccr-muted)]">
        Visibility
        <select
          name="public_visible"
          defaultValue="false"
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
        >
          <option value="false">Private</option>
          <option value="true">Public</option>
        </select>
      </label>
      <div className="md:col-span-2">
        <UploadcareImagesInput
          name="image_urls_json"
          helperText="Vehicle photos are securely uploaded and saved when you create the vehicle."
          uploadPurpose="vehicle-gallery"
        />
      </div>
      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={!csrfReady}
          className={buttonStyles({ variant: "primary", size: "sm" })}
        >
          {csrfReady ? "Save Vehicle" : "Loading..."}
        </button>
      </div>
      {!csrfReady ? (
        <p className="md:col-span-2 text-xs text-[var(--ccr-muted)]">
          Preparing secure form…
        </p>
      ) : null}
    </form>
  );
}

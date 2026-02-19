"use client";

import Link from "next/link";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { UploadcareImagesInput } from "@/components/admin/UploadcareImagesInput";

type VehicleDetail = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents?: number;
  status: string;
  image_urls_json?: string[];
};

type VehicleDetailFormProps = {
  vehicle: VehicleDetail;
};

function statusBadge(status: string) {
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    AVAILABLE: "bg-emerald-100 text-emerald-800",
    INACTIVE: "bg-slate-200 text-slate-800",
    MAINTENANCE: "bg-amber-100 text-amber-800",
    RESERVED: "bg-blue-100 text-blue-800",
    RENTED: "bg-purple-100 text-purple-800",
  };
  return styles[normalized] ?? "bg-slate-100 text-slate-700";
}

export function VehicleDetailForm({ vehicle }: VehicleDetailFormProps) {
  const [dailyRate, setDailyRate] = useState(String(vehicle.daily_rate_cents ?? ""));
  const [deposit, setDeposit] = useState(String(vehicle.deposit_cents ?? ""));
  const [images, setImages] = useState<string[]>(vehicle.image_urls_json ?? []);
  const [status, setStatus] = useState(
    vehicle.status === "INACTIVE"
      ? "unavailable"
      : vehicle.status === "MAINTENANCE"
        ? "maintenance"
        : "available",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayStatus =
    status === "maintenance" ? "MAINTENANCE" : status === "unavailable" ? "INACTIVE" : "AVAILABLE";

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        daily_rate: Number(dailyRate),
        deposit,
        image_urls_json: images,
        status,
      }),
    });

    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to save changes.");
      return;
    }

    setMessage("Vehicle updated.");
  }

  return (
    <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--ccr-text)]">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge(
                displayStatus,
              )}`}
            >
              {displayStatus}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/calendar?vehicleId=${vehicle.id}`}
            className="rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            View in Calendar
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Daily Rate (JMD)
          <input
            type="number"
            value={dailyRate}
            min="0"
            step="1"
            onChange={(event) => setDailyRate(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Deposit (JMD)
          <input
            type="number"
            value={deposit}
            min="0"
            step="1"
            onChange={(event) => setDeposit(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Availability
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
      </div>

      <div className="mt-5">
        <UploadcareImagesInput
          value={images}
          onChange={setImages}
          label="Vehicle Images"
          helperText="Upload photos that will appear on the fleet cards."
          displayMode="carousel"
        />
      </div>

      {message ? <p className="mt-3 text-xs text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

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

type VehicleProfile = {
  vin: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  vehicle_class: string | null;
  year: number | null;
  color: string | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
  notes: string | null;
};

type VehicleDetailFormProps = {
  vehicle: VehicleDetail;
  profile: VehicleProfile | null;
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

export function VehicleDetailForm({ vehicle, profile }: VehicleDetailFormProps) {
  const [dailyRate, setDailyRate] = useState(String(vehicle.daily_rate_cents ?? ""));
  const [deposit, setDeposit] = useState(String(vehicle.deposit_cents ?? ""));
  const [images, setImages] = useState<string[]>(vehicle.image_urls_json ?? []);
  const [vin, setVin] = useState(profile?.vin ?? "");
  const [licensePlate, setLicensePlate] = useState(profile?.license_plate ?? "");
  const [vehicleType, setVehicleType] = useState(profile?.vehicle_type ?? "");
  const [vehicleClass, setVehicleClass] = useState(profile?.vehicle_class ?? "");
  const [profileYear, setProfileYear] = useState(profile?.year ? String(profile.year) : "");
  const [color, setColor] = useState(profile?.color ?? "");
  const [currentLocationLabel, setCurrentLocationLabel] = useState(profile?.current_location_label ?? "");
  const [odometerValue, setOdometerValue] = useState(
    profile?.odometer_value === null || profile?.odometer_value === undefined ? "" : String(profile.odometer_value),
  );
  const [odometerUnit, setOdometerUnit] = useState(profile?.odometer_unit ?? "KM");
  const [fuelLevelValue, setFuelLevelValue] = useState(
    profile?.fuel_level_value === null || profile?.fuel_level_value === undefined ? "" : String(profile.fuel_level_value),
  );
  const [availableFrom, setAvailableFrom] = useState(profile?.available_from ?? "");
  const [availableUntil, setAvailableUntil] = useState(profile?.available_until ?? "");
  const [entryDate, setEntryDate] = useState(profile?.entry_date ?? "");
  const [exitDate, setExitDate] = useState(profile?.exit_date ?? "");
  const [notes, setNotes] = useState(profile?.notes ?? "");
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
    const vehicleResponse = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
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
        csrfToken,
      }),
    });

    const profileResponse = await fetch(`/api/admin/vehicles/${vehicle.id}/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        vin,
        license_plate: licensePlate,
        vehicle_type: vehicleType,
        vehicle_class: vehicleClass,
        year: profileYear.trim() ? Number(profileYear) : null,
        color,
        current_location_label: currentLocationLabel,
        odometer_value: odometerValue.trim() ? Number(odometerValue) : null,
        odometer_unit: odometerUnit,
        fuel_level_value: fuelLevelValue.trim() ? Number(fuelLevelValue) : null,
        available_from: availableFrom || null,
        available_until: availableUntil || null,
        entry_date: entryDate || null,
        exit_date: exitDate || null,
        notes,
        csrfToken,
      }),
    });

    const errors: string[] = [];
    if (!vehicleResponse.ok) {
      const data = (await vehicleResponse.json().catch(() => ({}))) as { error?: string };
      errors.push(data.error ?? "Failed to update vehicle.");
    }
    if (!profileResponse.ok) {
      const data = (await profileResponse.json().catch(() => ({}))) as { error?: string };
      errors.push(data.error ?? "Failed to update profile.");
    }

    setSaving(false);
    if (errors.length > 0) {
      setError(errors.join(" "));
      return;
    }

    setMessage("Vehicle and profile updated.");
  }

  return (
    <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
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
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Link
            href={`/admin/calendar?vehicleId=${vehicle.id}`}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            View in Calendar
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
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

      <div className="mt-6 border-t border-[var(--ccr-border)] pt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Profile details
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            VIN
            <input
              value={vin}
              onChange={(event) => setVin(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Vehicle identification number"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            License Plate
            <input
              value={licensePlate}
              onChange={(event) => setLicensePlate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Plate number"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Type
            <input
              value={vehicleType}
              onChange={(event) => setVehicleType(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="SUV, Sedan, etc."
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Class
            <input
              value={vehicleClass}
              onChange={(event) => setVehicleClass(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Economy, Premium, etc."
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Profile Year
            <input
              type="number"
              min="1900"
              max="2100"
              value={profileYear}
              onChange={(event) => setProfileYear(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Color
            <input
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Current Location
            <input
              value={currentLocationLabel}
              onChange={(event) => setCurrentLocationLabel(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Airport lot"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Odometer
            <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
              <input
                type="number"
                min="0"
                value={odometerValue}
                onChange={(event) => setOdometerValue(event.target.value)}
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="54000"
              />
              <select
                value={odometerUnit}
                onChange={(event) => setOdometerUnit(event.target.value)}
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="KM">KM</option>
                <option value="MI">MI</option>
              </select>
            </div>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Fuel Level (%)
            <input
              type="number"
              min="0"
              max="100"
              value={fuelLevelValue}
              onChange={(event) => setFuelLevelValue(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="75"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Available From
            <input
              type="date"
              value={availableFrom}
              onChange={(event) => setAvailableFrom(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Available Until
            <input
              type="date"
              value={availableUntil}
              onChange={(event) => setAvailableUntil(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Entry Date
            <input
              type="date"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Exit Date
            <input
              type="date"
              value={exitDate}
              onChange={(event) => setExitDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Inspection notes, assignment notes, etc."
            />
          </label>
        </div>
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

      <div className="mt-5 border-t border-[var(--ccr-border)] pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

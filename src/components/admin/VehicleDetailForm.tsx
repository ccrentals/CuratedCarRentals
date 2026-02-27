"use client";

import Link from "next/link";
import { useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { UploadcareImagesInput } from "@/components/admin/UploadcareImagesInput";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleDetail = {
  id: string;
  public_id: string;
  make: string;
  model: string;
  year: number;
  seat_count: number | null;
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
  seat_count: number | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
};

type VehicleNote = {
  id: string;
  note_text: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_email: string | null;
};

type VehicleDetailFormProps = {
  vehicle: VehicleDetail;
  profile: VehicleProfile | null;
  initialNotes: VehicleNote[];
};

type OverviewFormState = {
  dailyRate: string;
  deposit: string;
  status: "available" | "unavailable" | "maintenance";
  images: string[];
  vin: string;
  licensePlate: string;
  vehicleType: string;
  vehicleClass: string;
  profileYear: string;
  color: string;
  seatCount: string;
  currentLocationLabel: string;
  odometerValue: string;
  odometerUnit: string;
  fuelLevelValue: string;
  availableFrom: string;
  availableUntil: string;
  entryDate: string;
  exitDate: string;
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

function buildFormState(vehicle: VehicleDetail, profile: VehicleProfile | null): OverviewFormState {
  const status =
    vehicle.status === "INACTIVE"
      ? "unavailable"
      : vehicle.status === "MAINTENANCE"
        ? "maintenance"
        : "available";

  return {
    dailyRate: String(vehicle.daily_rate_cents ?? ""),
    deposit: String(vehicle.deposit_cents ?? ""),
    status,
    images: vehicle.image_urls_json ?? [],
    vin: profile?.vin ?? "",
    licensePlate: profile?.license_plate ?? "",
    vehicleType: profile?.vehicle_type ?? "",
    vehicleClass: profile?.vehicle_class ?? "",
    profileYear: profile?.year ? String(profile.year) : "",
    color: profile?.color ?? "",
    seatCount:
      profile?.seat_count === null || profile?.seat_count === undefined
        ? vehicle.seat_count === null || vehicle.seat_count === undefined
          ? ""
          : String(vehicle.seat_count)
        : String(profile.seat_count),
    currentLocationLabel: profile?.current_location_label ?? "",
    odometerValue:
      profile?.odometer_value === null || profile?.odometer_value === undefined
        ? ""
        : String(profile.odometer_value),
    odometerUnit: profile?.odometer_unit ?? "KM",
    fuelLevelValue:
      profile?.fuel_level_value === null || profile?.fuel_level_value === undefined
        ? ""
        : String(profile.fuel_level_value),
    availableFrom: profile?.available_from ?? "",
    availableUntil: profile?.available_until ?? "",
    entryDate: profile?.entry_date ?? "",
    exitDate: profile?.exit_date ?? "",
  };
}

export function VehicleDetailForm({ vehicle, profile, initialNotes }: VehicleDetailFormProps) {
  const initialForm = buildFormState(vehicle, profile);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<OverviewFormState>(initialForm);
  const [baseline, setBaseline] = useState<OverviewFormState>(initialForm);
  const [notes, setNotes] = useState<VehicleNote[]>(initialNotes);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayStatus =
    form.status === "maintenance" ? "MAINTENANCE" : form.status === "unavailable" ? "INACTIVE" : "AVAILABLE";

  function resetToViewMode() {
    setForm(baseline);
    setIsEditing(false);
  }

  async function handleSave() {
    if (saving) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const vehicleResponse = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          daily_rate: Number(form.dailyRate),
          deposit: form.deposit,
          image_urls_json: form.images,
          status: form.status,
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
          vin: form.vin,
          license_plate: form.licensePlate,
          vehicle_type: form.vehicleType,
          vehicle_class: form.vehicleClass,
          year: form.profileYear.trim() ? Number(form.profileYear) : null,
          color: form.color,
          seat_count: form.seatCount.trim() ? Number(form.seatCount) : null,
          current_location_label: form.currentLocationLabel,
          odometer_value: form.odometerValue.trim() ? Number(form.odometerValue) : null,
          odometer_unit: form.odometerUnit,
          fuel_level_value: form.fuelLevelValue.trim() ? Number(form.fuelLevelValue) : null,
          available_from: form.availableFrom || null,
          available_until: form.availableUntil || null,
          entry_date: form.entryDate || null,
          exit_date: form.exitDate || null,
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

      if (errors.length > 0) {
        setError(errors.join(" "));
        return;
      }

      const nextBaseline: OverviewFormState = {
        ...form,
        images: [...form.images],
      };
      setBaseline(nextBaseline);
      setForm(nextBaseline);
      setIsEditing(false);
      setMessage("Vehicle profile changes saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNote() {
    const noteText = noteDraft.trim();
    if (!noteText) {
      setError("Note text is required.");
      return;
    }
    if (savingNote) return;

    setSavingNote(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicle.id}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          noteText,
          csrfToken,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: VehicleNote;
      };
      if (!response.ok || !payload.ok || !payload.item) {
        setError(payload.error ?? "Unable to save note.");
        return;
      }
      setNotes((current) => [payload.item as VehicleNote, ...current]);
      setNoteDraft("");
      setIsAddingNote(false);
      setMessage("Note added.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    const confirmed = window.confirm("Delete this note?");
    if (!confirmed) return;
    if (savingNote) return;

    setSavingNote(true);
    setError(null);
    setMessage(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicle.id}/notes/${noteId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to delete note.");
        return;
      }
      setNotes((current) => current.filter((item) => item.id !== noteId));
      setMessage("Note deleted.");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle{" "}
            <span data-testid="vehicle-detail-public-id" className="text-[var(--ccr-text)]">
              {vehicle.public_id}
            </span>
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
          {!isEditing ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                setIsEditing(true);
              }}
              className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={resetToViewMode}
              disabled={saving}
              className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
            >
              Cancel edit
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Daily Rate (JMD)
          <input
            type="number"
            value={form.dailyRate}
            min="0"
            step="1"
            readOnly={!isEditing}
            onChange={(event) => setForm((current) => ({ ...current, dailyRate: event.target.value }))}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Deposit (JMD)
          <input
            type="number"
            value={form.deposit}
            min="0"
            step="1"
            readOnly={!isEditing}
            onChange={(event) => setForm((current) => ({ ...current, deposit: event.target.value }))}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Availability
          <select
            value={form.status}
            disabled={!isEditing}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as OverviewFormState["status"],
              }))
            }
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:cursor-default disabled:opacity-80"
          >
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
      </div>

      <div className="mt-6 border-t border-[var(--ccr-border)] pt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Profile details</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            VIN
            <input
              value={form.vin}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, vin: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="Vehicle identification number"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            License Plate
            <input
              value={form.licensePlate}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, licensePlate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="Plate number"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Type
            <input
              value={form.vehicleType}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, vehicleType: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="SUV, Sedan, etc."
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Class
            <input
              value={form.vehicleClass}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, vehicleClass: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="Economy, Premium, etc."
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Profile Year
            <input
              type="number"
              min="1900"
              max="2100"
              value={form.profileYear}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, profileYear: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Color
            <input
              value={form.color}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Current Location
            <input
              value={form.currentLocationLabel}
              readOnly={!isEditing}
              onChange={(event) =>
                setForm((current) => ({ ...current, currentLocationLabel: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="Airport lot"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            NUMBER OF SEATS
            <input
              data-testid="vehicle-profile-seat-count"
              type="number"
              step="1"
              min="1"
              max="60"
              value={form.seatCount}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, seatCount: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="5"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Odometer
            <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
              <input
                type="number"
                min="0"
                value={form.odometerValue}
                readOnly={!isEditing}
                onChange={(event) =>
                  setForm((current) => ({ ...current, odometerValue: event.target.value }))
                }
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
                placeholder="54000"
              />
              <select
                value={form.odometerUnit}
                disabled={!isEditing}
                onChange={(event) =>
                  setForm((current) => ({ ...current, odometerUnit: event.target.value }))
                }
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:cursor-default disabled:opacity-80"
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
              value={form.fuelLevelValue}
              readOnly={!isEditing}
              onChange={(event) =>
                setForm((current) => ({ ...current, fuelLevelValue: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
              placeholder="75"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Available From
            <input
              type="date"
              value={form.availableFrom}
              readOnly={!isEditing}
              onChange={(event) =>
                setForm((current) => ({ ...current, availableFrom: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Available Until
            <input
              type="date"
              value={form.availableUntil}
              readOnly={!isEditing}
              onChange={(event) =>
                setForm((current) => ({ ...current, availableUntil: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Entry Date
            <input
              type="date"
              value={form.entryDate}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, entryDate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Exit Date
            <input
              type="date"
              value={form.exitDate}
              readOnly={!isEditing}
              onChange={(event) => setForm((current) => ({ ...current, exitDate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] read-only:cursor-default read-only:opacity-80"
            />
          </label>
        </div>
      </div>

      <div className="mt-5">
        <UploadcareImagesInput
          value={form.images}
          onChange={(nextImages) => setForm((current) => ({ ...current, images: nextImages }))}
          label="Vehicle Images"
          helperText="Upload photos that will appear on the fleet cards."
          displayMode="carousel"
          disabled={!isEditing}
          actionSlot={
            isEditing ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="min-h-10 rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={resetToViewMode}
                  disabled={saving}
                  className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            ) : null
          }
        />
      </div>

      <div className="mt-6 border-t border-[var(--ccr-border)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Vehicle Notes</h2>
          {!isAddingNote ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                setIsAddingNote(true);
              }}
              className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Add note
            </button>
          ) : null}
        </div>

        {isAddingNote ? (
          <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
            <textarea
              rows={3}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              className="w-full rounded-lg border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Add a note for this vehicle"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateNote()}
                disabled={savingNote}
                className="min-h-10 rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {savingNote ? "Saving..." : "Save note"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingNote(false);
                  setNoteDraft("");
                }}
                disabled={savingNote}
                className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {notes.length < 1 ? (
          <p className="mt-3 text-xs text-[var(--ccr-muted)]">No notes have been added for this vehicle yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {notes.map((note) => (
              <article
                key={note.id}
                className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
              >
                <p className="text-sm text-[var(--ccr-text)] break-words">{note.note_text}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ccr-muted)]">
                  <p>
                    <DateTimeInline value={note.created_at} />
                    {note.created_by_email ? ` · ${note.created_by_email}` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDeleteNote(note.id)}
                    className="min-h-9 rounded-lg border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {message ? <p className="mt-3 text-xs text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

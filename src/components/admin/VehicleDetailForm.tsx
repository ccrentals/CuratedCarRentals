"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { UploadcareImagesInput } from "@/components/admin/UploadcareImagesInput";
import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const VEHICLE_SAVE_TIMEOUT_MS = 15000;

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
  public_visible: boolean;
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
  initialDerivedStatus: "AVAILABLE" | "UPCOMING" | "ON_RENT" | "DIRTY" | "UNAVAILABLE";
};

type OverviewFormState = {
  dailyRate: string;
  deposit: string;
  status: "available" | "unavailable" | "maintenance";
  visibility: "private" | "public";
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
  const normalized = status.toUpperCase().trim();
  const styles: Record<string, string> = {
    AVAILABLE:
      "border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]",
    UPCOMING:
      "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]",
    ON_RENT:
      "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]",
    DIRTY:
      "border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]",
    UNAVAILABLE:
      "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]",
  };
  return (
    styles[normalized] ??
    "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]"
  );
}

function derivedStatusLabel(status: VehicleDetailFormProps["initialDerivedStatus"]) {
  if (status === "ON_RENT") return "On Rent";
  if (status === "UPCOMING") return "Upcoming";
  if (status === "DIRTY") return "Dirty";
  if (status === "UNAVAILABLE") return "Unavailable";
  return "Available";
}

function buildFormState(vehicle: VehicleDetail, profile: VehicleProfile | null): OverviewFormState {
  const status =
    vehicle.status === "UNAVAILABLE" || vehicle.status === "INACTIVE"
      ? "unavailable"
      : vehicle.status === "MAINTENANCE"
        ? "maintenance"
        : "available";

  return {
    dailyRate: String(vehicle.daily_rate_cents ?? ""),
    deposit: String(vehicle.deposit_cents ?? ""),
    status,
    visibility: vehicle.public_visible ? "public" : "private",
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

export function VehicleDetailForm({
  vehicle,
  profile,
  initialNotes,
  initialDerivedStatus,
}: VehicleDetailFormProps) {
  const router = useRouter();
  const initialForm = buildFormState(vehicle, profile);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<OverviewFormState>(initialForm);
  const [baseline, setBaseline] = useState<OverviewFormState>(initialForm);
  const [notes, setNotes] = useState<VehicleNote[]>(initialNotes);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [deletingVehicle, setDeletingVehicle] = useState(false);
  const [showDeleteVehicleModal, setShowDeleteVehicleModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toastMessage = error ?? message;
  const toastTone: "error" | "success" = error ? "error" : "success";

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => {
      setMessage((current) => (current === toastMessage ? null : current));
      setError((current) => (current === toastMessage ? null : current));
    }, 4500);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const displayStatus = initialDerivedStatus;

  function resetToViewMode() {
    setForm(baseline);
    setIsEditing(false);
  }

  async function handleSave() {
    if (saving) return;

    setSaving(true);
    setMessage(null);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, VEHICLE_SAVE_TIMEOUT_MS);

    try {
      const csrfToken = await ensureCsrfToken();
      const vehicleResponse = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        signal: controller.signal,
        body: JSON.stringify({
          daily_rate: Number(form.dailyRate),
          deposit: form.deposit,
          image_urls_json: form.images,
          status: form.status,
          public_visible: form.visibility === "public",
          seat_count: form.seatCount.trim() ? Number(form.seatCount) : null,
          profile: {
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
          },
          csrfToken,
        }),
      });
      if (!vehicleResponse.ok) {
        const data = (await vehicleResponse.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to update vehicle profile.");
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setError("Vehicle save timed out. Please try again.");
        return;
      }
      setError(error instanceof Error ? error.message : "Failed to update vehicle profile.");
    } finally {
      window.clearTimeout(timeoutId);
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

  async function handleDeleteVehicle() {
    if (deletingVehicle) return;
    setDeletingVehicle(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        if (response.status === 409) {
          setShowDeleteVehicleModal(false);
          setError(
            "This vehicle is currently in use or has an upcoming booking, so it cannot be deleted right now.",
          );
          return;
        }
        setError(payload.error ?? "Unable to delete vehicle.");
        return;
      }
      setShowDeleteVehicleModal(false);
      router.push("/admin/vehicles?deleted=1");
    } finally {
      setDeletingVehicle(false);
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
              {derivedStatusLabel(displayStatus)}
            </span>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Link
            href={`/admin/calendar?vehicleId=${vehicle.id}`}
            className={buttonStyles({ variant: "secondary", size: "md" })}
          >
            View in Calendar
          </Link>
          <button
            type="button"
            disabled={saving || deletingVehicle}
            onClick={() => {
              setError(null);
              setMessage(null);
              setShowDeleteVehicleModal(true);
            }}
            className={buttonStyles({
              variant: "secondary",
              size: "md",
              className:
                "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent-strong)] hover:border-[var(--ccr-accent-strong)]",
            })}
            data-testid="vehicle-delete-button"
          >
            Delete vehicle
          </button>
          {!isEditing ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                setIsEditing(true);
              }}
              className={buttonStyles({
                variant: "secondary",
                size: "md",
                className: "bg-[var(--ccr-surface-soft)]",
              })}
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={resetToViewMode}
              disabled={saving}
              className={buttonStyles({
                variant: "secondary",
                size: "md",
                className: "bg-[var(--ccr-surface-soft)]",
              })}
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
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Visibility
          <select
            value={form.visibility}
            disabled={!isEditing}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                visibility: event.target.value as OverviewFormState["visibility"],
              }))
            }
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:cursor-default disabled:opacity-80"
            data-testid="vehicle-visibility-select"
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
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
          helperText="Upload photos that stay in our Uploadcare account and are tracked under this vehicle's gallery naming convention when you save."
          displayMode="carousel"
          disabled={!isEditing}
          actionSlot={
            isEditing ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className={buttonStyles({
                    variant: "primary",
                    size: "sm",
                    className: "rounded-lg",
                  })}
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={resetToViewMode}
                  disabled={saving}
                  className={buttonStyles({
                    variant: "secondary",
                    size: "sm",
                    className: "rounded-lg",
                  })}
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
                className={buttonStyles({
                  variant: "primary",
                  size: "sm",
                  className: "rounded-lg",
                })}
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
                className={buttonStyles({
                  variant: "secondary",
                  size: "sm",
                  className: "rounded-lg",
                })}
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
                    className={buttonStyles({
                      variant: "secondary",
                      size: "xs",
                      className: "rounded-lg border-[var(--ccr-accent)] text-[var(--ccr-accent-strong)]",
                    })}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {toastMessage ? (
        <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
          <div
            className={`w-full max-w-2xl rounded-xl border px-4 py-3 text-sm shadow-lg ${
              toastTone === "success"
                ? "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]"
                : "border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] text-[var(--ccr-clerk-danger-text)]"
            }`}
            role="status"
            aria-live="polite"
            data-testid="vehicle-detail-toast"
          >
            <div className="flex items-start justify-between gap-3">
              <p>{toastMessage}</p>
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setError(null);
                }}
                className={buttonStyles({
                  variant: "outline",
                  size: "xs",
                  className: "rounded-md border-current/40 px-2",
                })}
                aria-label="Dismiss notification"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteVehicleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ccr-primary)]/60 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-delete-title"
            aria-describedby="vehicle-delete-description"
            data-testid="vehicle-delete-modal"
          >
            <h4 id="vehicle-delete-title" className="text-lg font-bold text-[var(--ccr-text)]">
              Delete vehicle?
            </h4>
            <p id="vehicle-delete-description" className="mt-2 text-sm text-[var(--ccr-muted)]">
              This will delete the vehicle and remove it from the fleet list.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteVehicleModal(false)}
                disabled={deletingVehicle}
                className={buttonStyles({ variant: "secondary", size: "md" })}
                data-testid="vehicle-delete-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteVehicle()}
                disabled={deletingVehicle}
                className={buttonStyles({ variant: "danger", size: "md" })}
                data-testid="vehicle-delete-confirm"
              >
                {deletingVehicle ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

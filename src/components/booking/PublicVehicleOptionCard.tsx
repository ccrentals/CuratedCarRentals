import type { ReactNode } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

type PublicVehicleOption = {
  id: string;
  name: string;
  make: string;
  model: string;
  year?: number;
  daily_rate_cents: number;
  deposit_cents: number;
  images?: string[];
  category?: string;
  seats?: number;
  doors?: number;
  transmission?: string;
  bags?: number;
  fuelPolicy?: string;
  mileagePolicy?: string;
  airConditioning?: boolean;
  hybrid?: boolean;
  drivetrain?: string;
  description?: string;
};

type VehicleSpecItem = {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
};

type PublicVehicleOptionCardProps = {
  vehicle: PublicVehicleOption;
  selected: boolean;
  loading: boolean;
  rentalDays: number;
  onSelect: () => void;
  onDeselect: () => void;
  onImageClick?: () => void;
  formatMoney: (amount: number) => string;
};

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function displayVehicleName(vehicle: PublicVehicleOption) {
  const explicit = normalizeText(vehicle.name);
  if (explicit) return explicit;
  return `${normalizeText(vehicle.make)} ${normalizeText(vehicle.model)}`.trim() || "Vehicle";
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function UsersIcon() {
  return (
    <IconBase>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <circle cx="9" cy="7" r="4" />
    </IconBase>
  );
}

function DoorIcon() {
  return (
    <IconBase>
      <path d="M11 20H2" />
      <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z" />
      <path d="M11 4H8a2 2 0 0 0-2 2v14" />
      <path d="M14 12h.01" />
      <path d="M22 20h-3" />
    </IconBase>
  );
}

function TransmissionIcon() {
  return (
    <IconBase>
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </IconBase>
  );
}

function FuelIcon() {
  return (
    <IconBase>
      <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5" />
      <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" />
      <path d="M2 21h13" />
      <path d="M3 9h11" />
    </IconBase>
  );
}

function MileageIcon() {
  return (
    <IconBase>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </IconBase>
  );
}

function AcIcon() {
  return (
    <IconBase>
      <path d="m10 20-1.25-2.5L6 18" />
      <path d="M10 4 8.75 6.5 6 6" />
      <path d="m14 20 1.25-2.5L18 18" />
      <path d="m14 4 1.25 2.5L18 6" />
      <path d="m17 21-3-6h-4" />
      <path d="m17 3-3 6 1.5 3" />
      <path d="M2 12h6.5L10 9" />
      <path d="m20 10-1.5 2 1.5 2" />
      <path d="M22 12h-6.5L14 15" />
      <path d="m4 10 1.5 2L4 14" />
      <path d="m7 21 3-6-1.5-3" />
      <path d="m7 3 3 6h4" />
    </IconBase>
  );
}

function LuggageIcon() {
  return (
    <IconBase>
      <path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" />
      <path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" />
      <path d="M10 20h4" />
      <circle cx="16" cy="20" r="2" />
      <circle cx="8" cy="20" r="2" />
    </IconBase>
  );
}

function TypeIcon() {
  return (
    <IconBase>
      <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
      <path d="M7 14h.01" />
      <path d="M17 14h.01" />
      <rect width="18" height="8" x="3" y="10" rx="2" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </IconBase>
  );
}

function HybridIcon() {
  return (
    <IconBase>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </IconBase>
  );
}

function buildSpecs(vehicle: PublicVehicleOption): VehicleSpecItem[] {
  const seats = Number.isFinite(vehicle.seats) && Number(vehicle.seats) > 0 ? Number(vehicle.seats) : 5;
  const doors = Number.isFinite(vehicle.doors) && Number(vehicle.doors) > 0 ? Number(vehicle.doors) : 4;
  const transmission = normalizeText(vehicle.transmission) || "Automatic";
  const fuelPolicy = normalizeText(vehicle.fuelPolicy) || "Full to Full";
  const mileagePolicy = normalizeText(vehicle.mileagePolicy) || "Unl. Miles";
  const airConditioning = vehicle.airConditioning === false ? "No" : "Yes";
  const luggage = Number.isFinite(vehicle.bags) && Number(vehicle.bags) > 0 ? `${Number(vehicle.bags)} bag(s)` : "Included";
  const drivetrain = normalizeText(vehicle.drivetrain);

  return [
    { key: "persons", label: "Persons", value: `${seats}`, icon: <UsersIcon /> },
    { key: "doors", label: "Doors", value: `${doors}`, icon: <DoorIcon /> },
    { key: "transmission", label: "Transmission", value: transmission, icon: <TransmissionIcon /> },
    { key: "fuel", label: "Fuel", value: fuelPolicy, icon: <FuelIcon /> },
    { key: "mileage", label: "Mileage", value: mileagePolicy, icon: <MileageIcon /> },
    { key: "ac", label: "A/C", value: airConditioning, icon: <AcIcon /> },
    { key: "luggage", label: "Luggage", value: luggage, icon: <LuggageIcon /> },
    {
      key: "type",
      label: "Type",
      value: vehicle.hybrid ? "Hybrid" : drivetrain || normalizeText(vehicle.category) || "Standard",
      icon: vehicle.hybrid ? <HybridIcon /> : <TypeIcon />,
    },
  ];
}

export function PublicVehicleOptionCard({
  vehicle,
  selected,
  loading,
  rentalDays,
  onSelect,
  onDeselect,
  onImageClick,
  formatMoney,
}: PublicVehicleOptionCardProps) {
  const imageSrc = Array.isArray(vehicle.images) && vehicle.images.length > 0 ? vehicle.images[0] : "/window.svg";
  const vehicleName = displayVehicleName(vehicle);
  const category = normalizeText(vehicle.category);
  const subtitle = [vehicle.year ? String(vehicle.year) : "", category].filter(Boolean).join(" • ");
  const specs = buildSpecs(vehicle);
  const rentalTotal = Math.max(0, Math.round(vehicle.daily_rate_cents || 0) * Math.max(1, rentalDays));
  const description = normalizeText(vehicle.description);
  const canOpenGallery = typeof onImageClick === "function";

  return (
    <article
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border transition",
        selected
          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface)] shadow-[0_0_0_1px_var(--ccr-accent)]"
          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
      )}
    >
      <button
        type="button"
        onClick={canOpenGallery ? onImageClick : undefined}
        disabled={!canOpenGallery}
        className={cn(
          "relative block h-48 w-full overflow-hidden bg-[var(--ccr-surface-soft)] sm:h-52",
          canOpenGallery ? "cursor-zoom-in" : "cursor-default",
        )}
        aria-label={canOpenGallery ? `Open ${vehicleName} image gallery` : undefined}
      >
        <Image src={imageSrc} alt={vehicleName} fill className="object-cover" sizes="(max-width: 768px) 100vw, 25vw" />
        {vehicle.hybrid ? (
          <span className="absolute right-3 top-3 rounded-md bg-[var(--ccr-accent)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
            Hybrid
          </span>
        ) : null}
        {canOpenGallery ? (
          <span className="absolute bottom-3 right-3 rounded-md bg-[var(--ccr-primary)]/90 px-2.5 py-1 text-xs font-semibold text-[var(--ccr-on-primary)]">
            View photos
          </span>
        ) : null}
      </button>

      <div className="min-w-0 p-4 sm:p-5">
        <h3 className="break-words text-[1.35rem] font-bold leading-tight text-[var(--ccr-text)] sm:text-2xl">{vehicleName}</h3>
        <p className="mt-1 break-words text-sm text-[var(--ccr-muted)]">{subtitle || "Vehicle details"}</p>

        <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-3 min-[380px]:grid-cols-2 sm:gap-x-4">
          {specs.map((item) => (
            <div key={`${vehicle.id}-${item.key}`} className="flex min-w-0 items-start gap-1.5">
              <span className="mt-0.5 text-[var(--ccr-muted)]/90">{item.icon}</span>
              <div className="min-w-0">
                <p className="break-words text-xs text-[var(--ccr-muted)]">{item.label}</p>
                <p className="break-words text-sm font-medium leading-5 text-[var(--ccr-text)]">{item.value}</p>
              </div>
            </div>
          ))}
        </div>

        {description ? <p className="mt-4 break-words text-sm text-[var(--ccr-muted)]">{description}</p> : null}

        <div className="mt-4 flex min-w-0 flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">{formatMoney(vehicle.daily_rate_cents)} / Day</p>
            <p className="break-words text-xs text-[var(--ccr-muted)]">{rentalDays} day total: {formatMoney(rentalTotal)}</p>
            <p className="break-words text-xs text-[var(--ccr-muted)]">Deposit: {formatMoney(vehicle.deposit_cents)}</p>
          </div>
          <div className="flex w-full flex-col gap-2 min-[430px]:w-auto min-[430px]:flex-row">
            <button
              type="button"
              onClick={onSelect}
              disabled={loading}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm font-semibold min-[430px]:w-auto min-[430px]:flex-1 min-[430px]:flex-none",
                selected
                  ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-[var(--ccr-on-primary)]"
                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)]",
              )}
            >
              {selected ? "Selected" : "Select"}
            </button>
            {selected ? (
              <button
                type="button"
                onClick={onDeselect}
                className="w-full rounded-lg border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-semibold text-[var(--ccr-clerk-danger-text)] min-[430px]:w-auto min-[430px]:flex-1 min-[430px]:flex-none"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

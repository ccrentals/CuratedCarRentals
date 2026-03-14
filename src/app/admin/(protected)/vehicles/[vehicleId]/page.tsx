import Link from "next/link";
import { notFound } from "next/navigation";

import { VehicleBlockouts } from "@/components/admin/VehicleBlockouts";
import { VehicleChecklistPanel } from "@/components/admin/VehicleChecklistPanel";
import { VehicleDetailForm } from "@/components/admin/VehicleDetailForm";
import { VehicleFilesPanel } from "@/components/admin/VehicleFilesPanel";
import { VehicleMaintenancePanel } from "@/components/admin/VehicleMaintenancePanel";
import { VehicleDepreciationPanel } from "@/components/admin/VehicleDepreciationPanel";
import { VehicleReservationsPanel } from "@/components/admin/VehicleReservationsPanel";
import { VehiclePerformancePanel } from "@/components/admin/VehiclePerformancePanel";
import { VehicleAvailabilityRulesPanel } from "@/components/admin/VehicleAvailabilityRulesPanel";
import { VehiclePricingRulesPanel } from "@/components/admin/VehiclePricingRulesPanel";
import { VehiclePromoPanel } from "@/components/admin/VehiclePromoPanel";
import { VehicleInsurancePanel } from "@/components/admin/VehicleInsurancePanel";
import { AdminPillTabs } from "@/components/admin/AdminPillTabs";
import { resolveAdminActor } from "@/lib/auth/adminGuards";
import { DEFAULT_ADMIN_SETTINGS, loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import {
  deriveVehicleStatus,
  type DerivedVehicleStatus,
  type VehicleStatusBlockoutLike,
  type VehicleStatusBookingLike,
} from "@/lib/vehicles/vehicleStatus";

type VehicleDetail = {
  id: string;
  public_id: string;
  make: string;
  model: string;
  year: number;
  seat_count: number | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  image_urls_json: string[] | null;
};

type VehicleProfileRow = {
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
  needs_cleaning?: boolean;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
};

type VehicleNoteRow = {
  id: string;
  note_text: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_email: string | null;
};

type VehicleBookingRow = VehicleStatusBookingLike;
type VehicleBlockoutRow = VehicleStatusBlockoutLike;

const VEHICLE_DETAIL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "reservations", label: "Reservations" },
  { key: "performance", label: "Performance" },
  { key: "blockouts", label: "Blockouts" },
  { key: "availability", label: "Availability" },
  { key: "pricing", label: "Pricing" },
  { key: "files", label: "Files" },
  { key: "checklist", label: "Checklist" },
  { key: "maintenance", label: "Maintenance" },
  { key: "depreciation", label: "Depreciation" },
  { key: "promo", label: "Promo" },
  { key: "insurance", label: "Insurance" },
] as const;

type VehicleDetailTab = (typeof VEHICLE_DETAIL_TABS)[number]["key"];

function normalizeVehicleDetailTab(value: string | string[] | undefined): VehicleDetailTab {
  const candidate = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (!candidate) return "overview";
  const match = VEHICLE_DETAIL_TABS.find((tab) => tab.key === candidate);
  return match?.key ?? "overview";
}

export default async function AdminVehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { vehicleId } = await params;
  const query = await searchParams;
  const access = await resolveAdminActor({ requirement: "staff" });
  const canManageCommercial =
    access.ok && (access.actor.appRole === "ADMIN" || access.actor.appRole === "DEVELOPER");

  const requestedTab = normalizeVehicleDetailTab(query.tab);
  const maintenanceRecordId =
    typeof query.recordId === "string" && query.recordId.trim()
      ? query.recordId.trim()
      : null;

  const vehicleResult = await dbQuery<VehicleDetail>(
    "select id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json from vehicles where id = $1::uuid",
    [vehicleId],
  );

  const vehicle = vehicleResult.rows[0];
  if (!vehicle) {
    notFound();
  }

  let vehicleProfile: VehicleProfileRow | null = null;
  let needsCleaning = false;
  try {
    const profileResult = await dbQuery<VehicleProfileRow>(
      "select p.vin, p.license_plate, p.vehicle_type, p.vehicle_class, p.year, p.color, v.seat_count, p.current_location_label, p.odometer_value, p.odometer_unit, p.fuel_level_value, coalesce((to_jsonb(p)->>'needs_cleaning')::boolean, false) as needs_cleaning, p.available_from, p.available_until, p.entry_date, p.exit_date from vehicles v left join vehicle_profiles p on p.vehicle_id = v.id where v.id = $1::uuid limit 1",
      [vehicle.id],
    );
    vehicleProfile = profileResult.rows[0] ?? null;
    needsCleaning = vehicleProfile?.needs_cleaning === true;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }
  }

  const now = new Date();
  const bookingRows = await dbQuery<VehicleBookingRow>(
    `select
       b.id,
       b.status,
       b.archived_at,
       b.start_at,
       b.start_date,
       b.end_at,
       b.end_date,
       b.pricing_json,
       v.deposit_cents as vehicle_deposit_cents
     from bookings b
     join vehicles v on v.id = b.vehicle_id
     where b.vehicle_id = $1::uuid
       and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) >= $2::timestamptz
     order by coalesce(b.start_at, b.start_date::timestamptz) asc`,
    [vehicle.id, now.toISOString()],
  );

  let blockoutRows: VehicleBlockoutRow[] = [];
  try {
    const blockoutsResult = await dbQuery<VehicleBlockoutRow>(
      `select start_at, end_at
       from blockouts
       where vehicle_id = $1::uuid
         and end_at > $2::timestamptz
       order by start_at asc`,
      [vehicle.id, now.toISOString()],
    );
    blockoutRows = blockoutsResult.rows;
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
    const missingBlockouts = code === "42P01" && message.includes("blockouts");
    if (!missingBlockouts) {
      throw error;
    }
  }

  const derivedStatus: DerivedVehicleStatus = deriveVehicleStatus(vehicle, now, {
    bookings: bookingRows.rows,
    blockouts: blockoutRows,
    needsCleaning,
  });

  let vehicleNotes: VehicleNoteRow[] = [];
  try {
    const notesResult = await dbQuery<VehicleNoteRow>(
      `select n.id, n.note_text, n.created_at, n.created_by_user_id, u.email as created_by_email
       from vehicle_notes n
       left join users u on u.id = n.created_by_user_id
       where n.vehicle_id = $1::uuid and n.deleted_at is null
       order by n.created_at desc`,
      [vehicle.id],
    );
    vehicleNotes = notesResult.rows;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }
  }

  let documentFolders = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders];
  let documentTypeOptions = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentTypeOptions];
  let checklistTemplates = DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplates.map((template) => ({
    ...template,
  }));
  try {
    const { settings } = await loadAdminSettings();
    documentFolders = settings.vehicleDocumentFolders;
    documentTypeOptions = settings.vehicleDocumentTypeOptions;
    checklistTemplates = settings.vehicleChecklistTemplates.map((template) => ({
      ...template,
    }));
  } catch {
    documentFolders = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders];
    documentTypeOptions = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentTypeOptions];
    checklistTemplates = DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplates.map((template) => ({
      ...template,
    }));
  }

  const visibleTabs = canManageCommercial
    ? VEHICLE_DETAIL_TABS
    : VEHICLE_DETAIL_TABS.filter((tab) => tab.key !== "promo" && tab.key !== "insurance");
  const activeTab = visibleTabs.some((tab) => tab.key === requestedTab) ? requestedTab : "overview";

  return (
    <div data-testid="vehicle-detail" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/admin/vehicles" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to vehicles
      </Link>

      <AdminPillTabs
        tabs={visibleTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: `/admin/vehicles/${vehicle.id}?tab=${tab.key}`,
        }))}
        activeKey={activeTab}
        ariaLabel="Vehicle detail tabs"
        navTestId="vehicle-tabs"
        tabTestIdPrefix="vehicle-detail-tab"
      />

      <div className="mt-4 grid gap-6">
        {activeTab === "overview" ? (
          <VehicleDetailForm
            vehicle={vehicle}
            profile={vehicleProfile}
            initialNotes={vehicleNotes}
            initialDerivedStatus={derivedStatus}
          />
        ) : null}

        {activeTab === "reservations" ? <VehicleReservationsPanel vehicleId={vehicle.id} /> : null}

        {activeTab === "performance" ? <VehiclePerformancePanel vehicleId={vehicle.id} /> : null}

        {activeTab === "blockouts" ? (
          <VehicleBlockouts vehicle={{ id: vehicle.id, make: vehicle.make, model: vehicle.model }} />
        ) : null}

        {activeTab === "availability" ? (
          <VehicleAvailabilityRulesPanel vehicleId={vehicle.id} />
        ) : null}

        {activeTab === "pricing" ? <VehiclePricingRulesPanel vehicleId={vehicle.id} /> : null}

        {activeTab === "files" ? (
          <VehicleFilesPanel
            vehicleId={vehicle.id}
            folders={documentFolders}
            documentTypes={documentTypeOptions}
          />
        ) : null}

        {activeTab === "checklist" ? (
          <VehicleChecklistPanel
            vehicleId={vehicle.id}
            folders={documentFolders}
            templates={checklistTemplates}
          />
        ) : null}

        {activeTab === "maintenance" ? (
          <VehicleMaintenancePanel vehicleId={vehicle.id} initialRecordId={maintenanceRecordId} />
        ) : null}

        {activeTab === "depreciation" ? (
          <VehicleDepreciationPanel vehicleId={vehicle.id} />
        ) : null}

        {canManageCommercial && activeTab === "promo" ? (
          <VehiclePromoPanel
            vehicleId={vehicle.id}
            vehicleLabel={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          />
        ) : null}

        {canManageCommercial && activeTab === "insurance" ? (
          <VehicleInsurancePanel
            vehicleId={vehicle.id}
            vehicleLabel={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          />
        ) : null}
      </div>
    </div>
  );
}

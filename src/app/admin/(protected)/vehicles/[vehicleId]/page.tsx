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
import { DEFAULT_ADMIN_SETTINGS, loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

type VehicleDetail = {
  id: string;
  make: string;
  model: string;
  year: number;
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
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
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

  const activeTab = normalizeVehicleDetailTab(query.tab);
  const maintenanceRecordId =
    typeof query.recordId === "string" && query.recordId.trim()
      ? query.recordId.trim()
      : null;

  const vehicleResult = await dbQuery<VehicleDetail>(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, image_urls_json from vehicles where id = $1::uuid",
    [vehicleId],
  );

  const vehicle = vehicleResult.rows[0];
  if (!vehicle) {
    notFound();
  }

  let vehicleProfile: VehicleProfileRow | null = null;
  try {
    const profileResult = await dbQuery<VehicleProfileRow>(
      "select vin, license_plate, vehicle_type, vehicle_class, year, color, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date from vehicle_profiles where vehicle_id = $1::uuid limit 1",
      [vehicle.id],
    );
    vehicleProfile = profileResult.rows[0] ?? null;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }
  }

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
  let checklistTemplateItems = [...DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplateItems];
  try {
    const { settings } = await loadAdminSettings();
    documentFolders = settings.vehicleDocumentFolders;
    documentTypeOptions = settings.vehicleDocumentTypeOptions;
    checklistTemplateItems = settings.vehicleChecklistTemplateItems;
  } catch {
    documentFolders = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders];
    documentTypeOptions = [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentTypeOptions];
    checklistTemplateItems = [...DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplateItems];
  }

  return (
    <div data-testid="vehicle-detail" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/admin/vehicles" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to vehicles
      </Link>

      <nav
        aria-label="Vehicle detail tabs"
        data-testid="vehicle-tabs"
        className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-1"
      >
        <div className="flex min-w-max items-center gap-1">
          {VEHICLE_DETAIL_TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Link
                key={tab.key}
                href={`/admin/vehicles/${vehicle.id}?tab=${tab.key}`}
                data-testid={`vehicle-detail-tab-${tab.key}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-xs font-semibold whitespace-nowrap transition sm:min-h-0 ${
                  active
                    ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)] shadow-sm ring-1 ring-[var(--ccr-accent)]/40"
                    : "border-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-border)] hover:bg-[var(--ccr-surface-soft)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-4 grid gap-6">
        {activeTab === "overview" ? (
          <VehicleDetailForm vehicle={vehicle} profile={vehicleProfile} initialNotes={vehicleNotes} />
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
            templateItems={checklistTemplateItems}
          />
        ) : null}

        {activeTab === "maintenance" ? (
          <VehicleMaintenancePanel vehicleId={vehicle.id} initialRecordId={maintenanceRecordId} />
        ) : null}

        {activeTab === "depreciation" ? (
          <VehicleDepreciationPanel vehicleId={vehicle.id} />
        ) : null}
      </div>
    </div>
  );
}

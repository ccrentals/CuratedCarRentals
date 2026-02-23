import Link from "next/link";
import { notFound } from "next/navigation";

import { SortableTh } from "@/components/admin/SortableTh";
import { VehicleBlockouts } from "@/components/admin/VehicleBlockouts";
import { VehicleChecklistPanel } from "@/components/admin/VehicleChecklistPanel";
import { VehicleDetailForm } from "@/components/admin/VehicleDetailForm";
import { VehicleFilesPanel } from "@/components/admin/VehicleFilesPanel";
import { VehicleMaintenancePanel } from "@/components/admin/VehicleMaintenancePanel";
import { VehicleDepreciationPanel } from "@/components/admin/VehicleDepreciationPanel";
import {
  applySortToSearchParams,
  nextSort,
  readSortFromSearchParams,
  type SortDir,
} from "@/components/admin/tableSort";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
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

type ReservationRow = {
  id: string;
  customer_name: string;
  status: string;
  pickup_at: string;
  return_at: string;
  created_at: string;
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
  { key: "blockouts", label: "Blockouts" },
  { key: "files", label: "Files" },
  { key: "checklist", label: "Checklist" },
  { key: "maintenance", label: "Maintenance" },
  { key: "depreciation", label: "Depreciation" },
] as const;

const RESERVATION_SORT_COLUMNS = ["customer", "pickup", "return", "status", "created"] as const;

type VehicleDetailTab = (typeof VEHICLE_DETAIL_TABS)[number]["key"];
type ReservationSortBy = (typeof RESERVATION_SORT_COLUMNS)[number];
type ReservationSort = { sortBy: ReservationSortBy; sortDir: SortDir };

function normalizeVehicleDetailTab(value: string | string[] | undefined): VehicleDetailTab {
  const candidate = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (!candidate) return "overview";
  const match = VEHICLE_DETAIL_TABS.find((tab) => tab.key === candidate);
  return match?.key ?? "overview";
}

function normalizeReservationSort(queryParams: URLSearchParams): ReservationSort {
  const sort = readSortFromSearchParams(queryParams, {
    allowedSortBy: RESERVATION_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });

  return {
    sortBy: (sort.sortBy as ReservationSortBy | undefined) ?? "created",
    sortDir: (sort.sortDir as SortDir | undefined) ?? "desc",
  };
}

function reservationOrderBySql(sort: ReservationSort) {
  const direction = sort.sortDir === "asc" ? "asc" : "desc";

  if (sort.sortBy === "customer") {
    return `order by lower(c.full_name) ${direction}, b.id::text ${direction}`;
  }
  if (sort.sortBy === "pickup") {
    return `order by coalesce(b.start_at, b.start_date::timestamptz) ${direction}, b.id::text ${direction}`;
  }
  if (sort.sortBy === "return") {
    return `order by coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) ${direction}, b.id::text ${direction}`;
  }
  if (sort.sortBy === "status") {
    return `order by upper(b.status) ${direction}, b.id::text ${direction}`;
  }

  return `order by b.created_at ${direction}, b.id::text ${direction}`;
}

function reservationStatusLabel(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "Unknown";
  return normalized.replace(/_/g, " ");
}

function statusPillTone(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (["PENDING_PAYMENT", "AWAITING_CONFIRMATION"].includes(normalized)) {
    return "border-amber-300/50 bg-amber-500/15 text-amber-100";
  }
  if (["CONFIRMED", "IN_PROGRESS"].includes(normalized)) {
    return "border-cyan-300/40 bg-cyan-500/15 text-cyan-100";
  }
  if (["COMPLETED", "RETURNED"].includes(normalized)) {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  if (["CANCELLED", "NO_SHOW"].includes(normalized)) {
    return "border-rose-300/40 bg-rose-500/15 text-rose-100";
  }

  return "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
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
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") queryParams.set(key, value);
  }

  const activeTab = normalizeVehicleDetailTab(query.tab);
  const reservationSort = normalizeReservationSort(queryParams);
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

  let reservationRows: ReservationRow[] = [];
  if (activeTab === "reservations") {
    const orderBySql = reservationOrderBySql(reservationSort);
    const reservationsResult = await dbQuery<ReservationRow>(
      `select
          b.id,
          c.full_name as customer_name,
          b.status,
          coalesce(b.start_at, b.start_date::timestamptz) as pickup_at,
          coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) as return_at,
          b.created_at
       from bookings b
       join customers c on c.id = b.customer_id
       where b.vehicle_id = $1::uuid
       ${orderBySql}
       limit 250`,
      [vehicle.id],
    );
    reservationRows = reservationsResult.rows;
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

  const reservationSortHref = (columnKey: ReservationSortBy, defaultDirection: SortDir) => {
    const next = nextSort(reservationSort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    nextParams.set("tab", "reservations");
    const queryString = nextParams.toString();
    return queryString ? `/admin/vehicles/${vehicle.id}?${queryString}` : `/admin/vehicles/${vehicle.id}?tab=reservations`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/admin/vehicles" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to vehicles
      </Link>

      <nav
        aria-label="Vehicle detail tabs"
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

        {activeTab === "reservations" ? (
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Reservations</h2>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">Read-only bookings for this vehicle.</p>

            {reservationRows.length < 1 ? (
              <p className="mt-4 text-sm text-[var(--ccr-muted)]">No reservations found for this vehicle.</p>
            ) : (
              <>
                <div className="mt-4 divide-y divide-[var(--ccr-border)] md:hidden">
                  {reservationRows.map((row) => (
                    <article key={`mobile-${row.id}`} className="space-y-3 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                            UUID
                          </p>
                          <p className="mb-1 break-all font-mono text-[11px] text-[var(--ccr-muted)]">{row.id}</p>
                          <Link href={`/admin/bookings/${row.id}`} className="font-semibold text-[var(--ccr-text)] underline-offset-2 hover:underline">
                            {row.customer_name}
                          </Link>
                          <p className="text-xs text-[var(--ccr-muted)]">Created: <DateTimeInline value={row.created_at} /></p>
                        </div>
                        <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusPillTone(row.status)}`}>
                          {reservationStatusLabel(row.status)}
                        </span>
                      </div>

                      <dl className="grid grid-cols-1 gap-2 text-xs text-[var(--ccr-muted)]">
                        <div>
                          <dt>Pickup</dt>
                          <dd className="text-sm text-[var(--ccr-text)]"><DateTimeInline value={row.pickup_at} /></dd>
                        </div>
                        <div>
                          <dt>Return</dt>
                          <dd className="text-sm text-[var(--ccr-text)]"><DateTimeInline value={row.return_at} /></dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>

                <div className="mt-4 hidden overflow-x-auto md:block">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                      <tr>
                        <th className="px-4 py-3">UUID</th>
                        <SortableTh
                          label="Customer"
                          columnKey="customer"
                          sort={reservationSort}
                          href={reservationSortHref("customer", "asc")}
                        />
                        <SortableTh
                          label="Pickup"
                          columnKey="pickup"
                          sort={reservationSort}
                          href={reservationSortHref("pickup", "asc")}
                        />
                        <SortableTh
                          label="Return"
                          columnKey="return"
                          sort={reservationSort}
                          href={reservationSortHref("return", "asc")}
                        />
                        <SortableTh
                          label="Status"
                          columnKey="status"
                          sort={reservationSort}
                          href={reservationSortHref("status", "asc")}
                        />
                        <SortableTh
                          label="Created"
                          columnKey="created"
                          sort={reservationSort}
                          href={reservationSortHref("created", "desc")}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {reservationRows.map((row) => (
                        <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                          <td className="px-4 py-3 font-mono text-[11px] text-[var(--ccr-muted)]">{row.id}</td>
                          <td className="px-4 py-3 text-[var(--ccr-text)]">
                            <Link href={`/admin/bookings/${row.id}`} className="font-semibold text-[var(--ccr-text)]">
                              {row.customer_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[var(--ccr-text)]">
                            <TableDateTime value={row.pickup_at} />
                          </td>
                          <td className="px-4 py-3 text-[var(--ccr-text)]">
                            <TableDateTime value={row.return_at} />
                          </td>
                          <td className="px-4 py-3 text-[var(--ccr-muted)]">
                            <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusPillTone(row.status)}`}>
                              {reservationStatusLabel(row.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[var(--ccr-muted)]">
                            <TableDateTime value={row.created_at} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        ) : null}

        {activeTab === "blockouts" ? (
          <VehicleBlockouts vehicle={{ id: vehicle.id, make: vehicle.make, model: vehicle.model }} />
        ) : null}

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

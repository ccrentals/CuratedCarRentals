import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";
import {
  derivedVehicleStatusLabel,
  type DerivedVehicleStatus,
} from "@/lib/vehicles/vehicleStatus";

export const VEHICLE_SORT_COLUMNS = [
  "vehicle",
  "dailyRate",
  "deposit",
  "status",
  "created",
] as const;

export type VehicleSortBy = (typeof VEHICLE_SORT_COLUMNS)[number];

export type VehicleSortState = {
  sortBy: VehicleSortBy;
  sortDir: SortDir;
};

export const VEHICLE_FILTER_OPTIONS = ["all", "available", "upcoming", "dirty", "on_rent"] as const;
export type VehicleFilterOption = (typeof VEHICLE_FILTER_OPTIONS)[number];

export function normalizeVehicleFilter(value: unknown): VehicleFilterOption {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "available") return "available";
  if (normalized === "upcoming") return "upcoming";
  if (normalized === "dirty") return "dirty";
  if (normalized === "on_rent") return "on_rent";
  return "all";
}

export function normalizeVehicleSort(searchParams: URLSearchParams): VehicleSortState {
  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: VEHICLE_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });

  return {
    sortBy: (sort.sortBy as VehicleSortBy | undefined) ?? "created",
    sortDir: (sort.sortDir as SortDir | undefined) ?? "desc",
  };
}

export function vehicleListOrderBySql(sort: VehicleSortState) {
  const direction = sort.sortDir === "asc" ? "asc" : "desc";

  if (sort.sortBy === "vehicle") {
    return `order by v.year ${direction}, lower(v.make) ${direction}, lower(v.model) ${direction}, v.id::text ${direction}`;
  }
  if (sort.sortBy === "dailyRate") {
    return `order by v.daily_rate_cents ${direction}, v.id::text ${direction}`;
  }
  if (sort.sortBy === "deposit") {
    return `order by v.deposit_cents ${direction}, v.id::text ${direction}`;
  }
  if (sort.sortBy === "status") {
    return `order by upper(v.status) ${direction}, v.id::text ${direction}`;
  }

  return `order by v.created_at ${direction}, v.id::text ${direction}`;
}

export function vehicleFilterWhereSql(
  _filter: VehicleFilterOption,
  search: string,
  options?: { includeProfileSearch?: boolean },
): { whereSql: string; values: string[] } {
  const includeProfileSearch = options?.includeProfileSearch !== false;
  const whereParts: string[] = [];
  const values: string[] = [];

  if (search) {
    values.push(`%${search}%`);
    const baseSearch = [
      `v.make ilike $${values.length}`,
      `v.model ilike $${values.length}`,
      `v.public_id ilike $${values.length}`,
      `v.id::text ilike $${values.length}`,
      `cast(v.year as text) ilike $${values.length}`,
    ];
    if (includeProfileSearch) {
      baseSearch.push(`p.vin ilike $${values.length}`);
      baseSearch.push(`p.license_plate ilike $${values.length}`);
    }
    whereParts.push(
      `(${baseSearch.join(" or ")})`,
    );
  }

  if (whereParts.length < 1) {
    return { whereSql: "", values };
  }

  return { whereSql: `where ${whereParts.join(" and ")}`, values };
}

export function vehicleStatusLabel(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "AVAILABLE") return "Available";
  if (normalized === "UPCOMING") return "Upcoming";
  if (normalized === "UNAVAILABLE") return "Unavailable";
  if (normalized === "MAINTENANCE") return "Dirty";
  if (normalized === "DIRTY") return "Dirty";
  if (normalized === "RENTED") return "On Rent";
  if (normalized === "ON_RENT") return "On Rent";
  if (normalized === "RESERVED") return "Reserved";
  if (normalized === "INACTIVE") return "Inactive";
  return normalized || "Unknown";
}

export function matchesVehicleFilter(
  filter: VehicleFilterOption,
  status: DerivedVehicleStatus,
) {
  if (filter === "all") return true;
  if (filter === "available") return status === "AVAILABLE";
  if (filter === "upcoming") return status === "UPCOMING";
  if (filter === "dirty") return status === "DIRTY";
  if (filter === "on_rent") return status === "ON_RENT";
  return true;
}

export function vehicleStatusSortRank(status: DerivedVehicleStatus) {
  if (status === "AVAILABLE") return 1;
  if (status === "UPCOMING") return 2;
  if (status === "ON_RENT") return 3;
  if (status === "DIRTY") return 4;
  return 5;
}

export function vehicleDerivedStatusLabel(status: DerivedVehicleStatus) {
  return derivedVehicleStatusLabel(status);
}

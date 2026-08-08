import { dbQuery } from "@/lib/db";
import {
  formatBookingVehicleInspectionImageCategory,
  isPickupInspectionEditableForStatus,
  isReturnInspectionEditableForStatus,
  type BookingVehicleInspectionImageCategory,
  type BookingVehicleInspectionType,
} from "@/lib/bookings/vehicleInspectionShared";
import { normalizeUploadcareDeliveryUrl } from "@/lib/uploads/uploadcare";
import { extractBunnyPublicStorageKey, getBunnyPublicCdnUrl } from "@/lib/uploads/bunny";

export const ADMIN_MEDIA_SOURCES = ["inspections", "vehicles", "vehicle-files"] as const;
export type AdminMediaSource = (typeof ADMIN_MEDIA_SOURCES)[number];

export type AdminMediaItem = {
  id: string;
  source: AdminMediaSource;
  sourceLabel: string;
  title: string;
  fileName: string;
  previewUrl: string;
  openUrl: string;
  manageUrl: string;
  vehicleId: string;
  vehiclePublicId: string;
  vehicleLabel: string;
  bookingId: string | null;
  bookingPublicId: string | null;
  category: string;
  categoryLabel: string;
  subtype: string;
  subtypeLabel: string;
  uploadedBy: string | null;
  createdAt: string;
  isPrimary: boolean;
  canRemove: boolean;
  removeUrl: string | null;
  removePayload: Record<string, string> | null;
};

export type AdminMediaFilters = {
  query?: string;
  vehicleId?: string;
  category?: string;
  subtype?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: "newest" | "oldest";
};

type DbQueryFn = <T = unknown>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[]; rowCount?: number | null }>;

type InspectionMediaRow = {
  id: string;
  inspection_id: string;
  booking_id: string;
  booking_public_id: string | null;
  booking_status: string | null;
  inspection_type: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  label: string | null;
  generated_file_name: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  uploaded_by_display: string | null;
  created_at: string;
  vehicle_id: string;
  vehicle_public_id: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number | null;
};

type VehicleGalleryRow = {
  id: string;
  public_id: string | null;
  make: string;
  model: string;
  year: number | null;
  status: string | null;
  image_urls_json: unknown;
  features_json: unknown;
  created_at: string;
  updated_at: string;
};

type VehicleFileRow = {
  id: string;
  vehicle_id: string;
  vehicle_public_id: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number | null;
  folder: string;
  document_type: string | null;
  title: string;
  label: string | null;
  mime_type: string | null;
  uploaded_by_display: string | null;
  created_at: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function vehicleLabel(row: {
  vehicle_year?: number | null;
  vehicle_make: string;
  vehicle_model: string;
}) {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(" ");
}

function isImageMimeType(value: string | null) {
  return normalizeText(value).toLowerCase().startsWith("image/");
}

function normalizeVehicleGalleryUrl(value: unknown) {
  const uploadcareUrl = normalizeUploadcareDeliveryUrl(value);
  if (uploadcareUrl) return uploadcareUrl;
  const bunnyPublicCdnUrl = getBunnyPublicCdnUrl();
  return bunnyPublicCdnUrl && extractBunnyPublicStorageKey(value, bunnyPublicCdnUrl)
    ? String(value).trim()
    : null;
}

function inspectionSubtypeLabel(value: BookingVehicleInspectionType) {
  return value === "RETURN" ? "Return" : "Pickup";
}

function mapInspectionRows(rows: InspectionMediaRow[]): AdminMediaItem[] {
  return rows
    .filter((row) => isImageMimeType(row.mime_type))
    .map((row) => {
      const name =
        normalizeText(row.generated_file_name) ||
        normalizeText(row.original_file_name) ||
        `${row.booking_public_id ?? row.booking_id}-${row.inspection_type.toLowerCase()}-image`;
      const imageUrl = `/api/admin/bookings/${encodeURIComponent(row.booking_id)}/inspections/images/${encodeURIComponent(row.id)}`;
      const canRemove =
        row.inspection_type === "PICKUP"
          ? isPickupInspectionEditableForStatus(row.booking_status)
          : isReturnInspectionEditableForStatus(row.booking_status);

      return {
        id: row.id,
        source: "inspections",
        sourceLabel: "Vehicle inspection",
        title: normalizeText(row.label) || formatBookingVehicleInspectionImageCategory(row.category),
        fileName: name,
        previewUrl: imageUrl,
        openUrl: imageUrl,
        manageUrl: `/admin/bookings/${encodeURIComponent(row.booking_id)}`,
        vehicleId: row.vehicle_id,
        vehiclePublicId: row.vehicle_public_id ?? row.vehicle_id,
        vehicleLabel: vehicleLabel(row),
        bookingId: row.booking_id,
        bookingPublicId: row.booking_public_id ?? row.booking_id,
        category: row.category,
        categoryLabel: formatBookingVehicleInspectionImageCategory(row.category),
        subtype: row.inspection_type,
        subtypeLabel: inspectionSubtypeLabel(row.inspection_type),
        uploadedBy: normalizeText(row.uploaded_by_display) || null,
        createdAt: row.created_at,
        isPrimary: false,
        canRemove,
        removeUrl: canRemove
          ? `/api/admin/bookings/${encodeURIComponent(row.booking_id)}/inspections/images/${encodeURIComponent(row.id)}`
          : null,
        removePayload: canRemove
          ? {
              inspectionId: row.inspection_id,
              inspectionType: row.inspection_type,
            }
          : null,
      };
    });
}

function galleryEntries(row: VehicleGalleryRow) {
  const features = toObject(row.features_json);
  const storedGallery = toArray(features.gallery_images);
  const imageUrls = toArray(row.image_urls_json)
    .map(normalizeText)
    .filter(Boolean);

  if (storedGallery.length > 0) {
    return storedGallery
      .map((value, index) => {
        const entry = toObject(value);
        const url = normalizeVehicleGalleryUrl(normalizeText(entry.url));
        if (!url) return null;
        const position = Number(entry.position);
        return {
          name:
            normalizeText(entry.name) ||
            `${row.public_id ?? row.id}-gallery-${String(index + 1).padStart(2, "0")}`,
          url,
          position: Number.isFinite(position) && position > 0 ? position : index + 1,
          isPrimary: entry.isPrimary === true || index === 0,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  return imageUrls
    .map((value, index) => {
      const url = normalizeVehicleGalleryUrl(value);
      if (!url) return null;
      return {
        name: `${row.public_id ?? row.id}-gallery-${String(index + 1).padStart(2, "0")}`,
        url,
        position: index + 1,
        isPrimary: index === 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function mapVehicleGalleryRows(rows: VehicleGalleryRow[]): AdminMediaItem[] {
  return rows.flatMap((row) =>
    galleryEntries(row).map((entry) => ({
      id: `${row.id}:${entry.position}`,
      source: "vehicles" as const,
      sourceLabel: "Vehicle gallery",
      title: entry.isPrimary ? "Primary vehicle image" : `Gallery image ${entry.position}`,
      fileName: entry.name,
      previewUrl: entry.url,
      openUrl: entry.url,
      manageUrl: `/admin/vehicles/${encodeURIComponent(row.id)}?tab=overview`,
      vehicleId: row.id,
      vehiclePublicId: row.public_id ?? row.id,
      vehicleLabel: vehicleLabel({
        vehicle_year: row.year,
        vehicle_make: row.make,
        vehicle_model: row.model,
      }),
      bookingId: null,
      bookingPublicId: null,
      category: entry.isPrimary ? "PRIMARY" : "GALLERY",
      categoryLabel: entry.isPrimary ? "Primary" : "Gallery",
      subtype: normalizeText(row.status).toUpperCase() || "UNKNOWN",
      subtypeLabel: normalizeText(row.status) || "Unknown status",
      uploadedBy: null,
      createdAt: row.updated_at || row.created_at,
      isPrimary: entry.isPrimary,
      canRemove: false,
      removeUrl: null,
      removePayload: null,
    })),
  );
}

function mapVehicleFileRows(rows: VehicleFileRow[]): AdminMediaItem[] {
  return rows
    .filter((row) => isImageMimeType(row.mime_type))
    .map((row) => {
      const viewUrl = `/api/admin/vehicles/${encodeURIComponent(row.vehicle_id)}/documents/${encodeURIComponent(row.id)}/file`;
      const folder = normalizeText(row.folder) || "Unsorted";
      const documentType = normalizeText(row.document_type).toUpperCase() || "OTHER";
      return {
        id: row.id,
        source: "vehicle-files",
        sourceLabel: "Vehicle file",
        title: normalizeText(row.label) || normalizeText(row.title) || "Vehicle image file",
        fileName: normalizeText(row.title) || `${row.vehicle_public_id ?? row.vehicle_id}-file`,
        previewUrl: viewUrl,
        openUrl: viewUrl,
        manageUrl: `/admin/vehicles/${encodeURIComponent(row.vehicle_id)}?tab=files`,
        vehicleId: row.vehicle_id,
        vehiclePublicId: row.vehicle_public_id ?? row.vehicle_id,
        vehicleLabel: vehicleLabel(row),
        bookingId: null,
        bookingPublicId: null,
        category: folder.toUpperCase(),
        categoryLabel: folder,
        subtype: documentType,
        subtypeLabel: documentType.replaceAll("_", " "),
        uploadedBy: normalizeText(row.uploaded_by_display) || null,
        createdAt: row.created_at,
        isPrimary: false,
        canRemove: true,
        removeUrl: `/api/admin/vehicles/${encodeURIComponent(row.vehicle_id)}/documents/${encodeURIComponent(row.id)}`,
        removePayload: {},
      };
    });
}

async function loadInspectionMedia(query: DbQueryFn) {
  const result = await query<InspectionMediaRow>(
    `select
       img.id,
       img.inspection_id,
       img.booking_id,
       b.public_id as booking_public_id,
       b.status as booking_status,
       img.inspection_type,
       img.category,
       img.label,
       img.generated_file_name,
       img.original_file_name,
       img.mime_type,
       coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.username), ''), nullif(trim(u.email), '')) as uploaded_by_display,
       img.created_at,
       v.id as vehicle_id,
       v.public_id as vehicle_public_id,
       v.make as vehicle_make,
       v.model as vehicle_model,
       v.year as vehicle_year
     from booking_vehicle_inspection_images img
     join bookings b on b.id = img.booking_id
     join vehicles v on v.id = b.vehicle_id
     left join users u on u.id = img.uploaded_by_user_id
     where img.archived_at is null
     order by img.created_at desc`,
  );
  return mapInspectionRows(result.rows);
}

async function loadVehicleGalleryMedia(query: DbQueryFn) {
  const result = await query<VehicleGalleryRow>(
    `select id, public_id, make, model, year, status, image_urls_json, features_json, created_at, updated_at
     from vehicles
     where deleted_at is null
     order by updated_at desc, id desc`,
  );
  return mapVehicleGalleryRows(result.rows);
}

async function loadVehicleFileMedia(query: DbQueryFn) {
  const result = await query<VehicleFileRow>(
    `select
       d.id,
       d.vehicle_id,
       v.public_id as vehicle_public_id,
       v.make as vehicle_make,
       v.model as vehicle_model,
       v.year as vehicle_year,
       d.folder,
       d.document_type,
       d.title,
       d.label,
       d.mime_type,
       coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.username), ''), nullif(trim(u.email), '')) as uploaded_by_display,
       d.created_at
     from vehicle_documents d
     join vehicles v on v.id = d.vehicle_id
     left join users u on u.id = d.uploaded_by_user_id
     where d.archived_at is null
       and lower(coalesce(d.mime_type, '')) like 'image/%'
       and v.deleted_at is null
     order by d.created_at desc`,
  );
  return mapVehicleFileRows(result.rows);
}

export async function loadAdminMediaItems(
  source: AdminMediaSource,
  deps: { query?: DbQueryFn } = {},
) {
  const query = deps.query ?? (dbQuery as DbQueryFn);
  if (source === "vehicles") return loadVehicleGalleryMedia(query);
  if (source === "vehicle-files") return loadVehicleFileMedia(query);
  return loadInspectionMedia(query);
}

export function filterAdminMediaItems(items: AdminMediaItem[], filters: AdminMediaFilters) {
  const query = normalizeText(filters.query).toLowerCase();
  const vehicleId = normalizeText(filters.vehicleId);
  const category = normalizeText(filters.category).toUpperCase();
  const subtype = normalizeText(filters.subtype).toUpperCase();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom ?? "")
    ? new Date(`${filters.dateFrom}T00:00:00.000Z`).getTime()
    : null;
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo ?? "")
    ? new Date(`${filters.dateTo}T23:59:59.999Z`).getTime()
    : null;

  const filtered = items.filter((item) => {
    if (vehicleId && item.vehicleId !== vehicleId) return false;
    if (category && item.category.toUpperCase() !== category) return false;
    if (subtype && item.subtype.toUpperCase() !== subtype) return false;
    const createdAt = new Date(item.createdAt).getTime();
    if (dateFrom !== null && createdAt < dateFrom) return false;
    if (dateTo !== null && createdAt > dateTo) return false;
    if (!query) return true;
    return [
      item.title,
      item.fileName,
      item.vehicleLabel,
      item.vehiclePublicId,
      item.bookingPublicId,
      item.categoryLabel,
      item.subtypeLabel,
      item.uploadedBy,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return [...filtered].sort((left, right) => {
    const direction = filters.sort === "oldest" ? 1 : -1;
    const dateDifference =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return dateDifference !== 0 ? dateDifference * direction : left.id.localeCompare(right.id);
  });
}

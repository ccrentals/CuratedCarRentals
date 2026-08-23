import { timingSafeEqual } from "node:crypto";

import {
  BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES,
  BOOKING_VEHICLE_INSPECTION_TYPES,
  isPickupInspectionEditableForStatus,
  isReturnInspectionEditableForStatus,
  loadBookingVehicleInspectionSummaries,
  createBookingVehicleInspectionImages,
  type BookingVehicleInspectionImageCategory,
  type BookingVehicleInspectionType,
} from "@/lib/bookings/vehicleInspection";
import {
  CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
  type CustomerPrivateFileRow,
} from "@/lib/customers/privateFiles";
import { dbQuery, getDbPool } from "@/lib/db";
import {
  createBunnyBookingInspectionStorageKey,
  createBunnyCustomerLegalIdStorageKey,
  createBunnyStorageKey,
  createBunnyVehicleGalleryStorageKey,
  buildBunnyPublicUrl,
  getBunnyStorageConfig,
} from "@/lib/uploads/bunny";
import {
  createDirectUploadToken,
  DIRECT_UPLOAD_TOKEN_TTL_SECONDS,
  hashDirectUploadToken,
  type DirectImageMimeType,
  type DirectImageUploadPurpose,
  type DirectImageUploadScope,
} from "@/lib/uploads/directUpload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACTIVE_UPLOADS_PER_USER = 20;

type UploadDestination = {
  entityType: "vehicle" | "landing_content" | "customer" | "booking";
  entityId: string | null;
  scope: DirectImageUploadScope;
  storageKey: string;
  context: Record<string, unknown>;
};

export type DirectUploadSessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  purpose: DirectImageUploadPurpose;
  storage_scope: DirectImageUploadScope;
  entity_type: string;
  entity_id: string | null;
  storage_key: string;
  original_file_name: string;
  mime_type: DirectImageMimeType;
  expected_bytes: string | number;
  checksum_sha256: string | null;
  received_bytes: string | number | null;
  received_checksum_sha256: string | null;
  status: string;
  context_json: Record<string, unknown>;
  final_result_json: Record<string, unknown> | null;
  expires_at: string;
  uploaded_at: string | null;
};

type DirectUploadFinalizationResult = {
  purpose: DirectImageUploadPurpose;
  entityId: string | null;
  result: Record<string, unknown>;
  audit: {
    entityType: "vehicle" | "booking" | "customer";
    entityId: string;
    context: string;
  } | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredUuid(value: unknown, label: string) {
  const normalized = text(value);
  if (!UUID_RE.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function inspectionType(value: unknown): BookingVehicleInspectionType | null {
  const normalized = text(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_TYPES.find((entry) => entry === normalized) ?? null;
}

function inspectionCategory(value: unknown): BookingVehicleInspectionImageCategory | null {
  const normalized = text(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES.find((entry) => entry === normalized) ?? null;
}

export function getDirectUploadGatewayUrl() {
  const value = text(process.env.DIRECT_IMAGE_UPLOAD_GATEWAY_URL);
  if (!value) throw new Error("Direct image upload gateway is not configured.");
  const url = new URL(value);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("Direct image upload gateway must use HTTPS.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Direct image upload gateway must be a standalone origin.");
  }
  return url.origin;
}

export function requireGatewaySecret(request: Request) {
  const expected = text(process.env.DIRECT_IMAGE_UPLOAD_GATEWAY_SHARED_SECRET);
  const actual = text(request.headers.get("x-upload-gateway-secret"));
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function resolveDirectUploadDestination(input: {
  purpose: DirectImageUploadPurpose;
  entityId: unknown;
  fileName: string;
  context: Record<string, unknown>;
}): Promise<UploadDestination> {
  if (input.purpose === "LANDING_CONTENT") {
    return {
      entityType: "landing_content",
      entityId: null,
      scope: "public",
      storageKey: createBunnyStorageKey({ scope: "public", fileName: input.fileName }),
      context: {},
    };
  }

  if (input.purpose === "VEHICLE_GALLERY") {
    if (!text(input.entityId)) {
      return {
        entityType: "vehicle",
        entityId: null,
        scope: "public",
        storageKey: createBunnyStorageKey({ scope: "public", fileName: input.fileName }),
        context: { pendingVehicle: true },
      };
    }
    const vehicleId = requiredUuid(input.entityId, "Vehicle ID");
    const result = await dbQuery<{
      public_id: string;
      make: string;
      model: string;
      gallery_count: number;
    }>(
      `select public_id, make, model, coalesce(jsonb_array_length(image_urls_json), 0)::int as gallery_count
       from vehicles where id = $1::uuid and deleted_at is null limit 1`,
      [vehicleId],
    );
    const vehicle = result.rows[0];
    if (!vehicle) throw new Error("Vehicle upload context was not found.");
    return {
      entityType: "vehicle",
      entityId: vehicleId,
      scope: "public",
      storageKey: createBunnyVehicleGalleryStorageKey({
        vehiclePublicId: vehicle.public_id,
        vehicleLabel: `${vehicle.make} ${vehicle.model}`,
        position: vehicle.gallery_count + 1,
        fileName: input.fileName,
      }),
      context: { vehiclePublicId: vehicle.public_id },
    };
  }

  if (input.purpose === "CUSTOMER_LEGAL_ID") {
    const customerId = requiredUuid(input.entityId, "Customer ID");
    const result = await dbQuery<{ id: string; public_id: string | null }>(
      "select id, public_id from customers where id = $1::uuid limit 1",
      [customerId],
    );
    const customer = result.rows[0];
    if (!customer) throw new Error("Customer not found.");
    const customerPublicId = customer.public_id ?? customer.id;
    return {
      entityType: "customer",
      entityId: customerId,
      scope: "private",
      storageKey: createBunnyCustomerLegalIdStorageKey({ customerPublicId, fileName: input.fileName }),
      context: { customerPublicId },
    };
  }

  const bookingId = requiredUuid(input.entityId, "Booking ID");
  const inspectionId = requiredUuid(input.context.inspectionId, "Inspection ID");
  const type = inspectionType(input.context.inspectionType);
  const category = inspectionCategory(input.context.category);
  if (!type || !category) throw new Error("Inspection type or image category is invalid.");
  const booking = await dbQuery<{ status: string }>(
    "select status from bookings where id = $1::uuid limit 1",
    [bookingId],
  );
  const status = booking.rows[0]?.status;
  if (!status) throw new Error("Booking not found.");
  const editable =
    type === "PICKUP"
      ? isPickupInspectionEditableForStatus(status)
      : isReturnInspectionEditableForStatus(status);
  if (!editable) throw new Error(`${type === "PICKUP" ? "Pickup" : "Return"} inspection images are locked.`);
  const summaries = await loadBookingVehicleInspectionSummaries(bookingId);
  const summary = type === "PICKUP" ? summaries?.pickup : summaries?.returnInspection;
  if (!summary?.inspectionId || summary.inspectionId !== inspectionId) {
    throw new Error("Save the inspection as a draft before uploading images.");
  }
  return {
    entityType: "booking",
    entityId: bookingId,
    scope: "private",
    storageKey: createBunnyBookingInspectionStorageKey({
      bookingId,
      inspectionType: type,
      category,
      fileName: input.fileName,
    }),
    context: { inspectionId, inspectionType: type, category },
  };
}

export async function createDirectUploadSession(input: {
  userId: string;
  purpose: DirectImageUploadPurpose;
  destination: UploadDestination;
  fileName: string;
  mimeType: DirectImageMimeType;
  size: number;
  checksum: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DIRECT_UPLOAD_TOKEN_TTL_SECONDS * 1000);
  const { token, tokenHash } = createDirectUploadToken();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const active = (await client.query(
      `select count(*)::text as count from admin_image_upload_sessions
       where user_id = $1::uuid and status in ('AUTHORIZED', 'UPLOADING') and expires_at > now()`,
      [input.userId],
    )) as { rows: Array<{ count: string }> };
    if (Number(active.rows[0]?.count ?? 0) >= MAX_ACTIVE_UPLOADS_PER_USER) {
      throw new Error("Too many uploads are already in progress. Finish or wait for them to expire.");
    }
    const inserted = (await client.query(
      `insert into admin_image_upload_sessions (
         token_hash, user_id, purpose, storage_scope, entity_type, entity_id, storage_key,
         original_file_name, mime_type, expected_bytes, checksum_sha256, context_json, expires_at
       ) values ($1, $2::uuid, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12::jsonb, $13)
       returning id`,
      [
        tokenHash,
        input.userId,
        input.purpose,
        input.destination.scope,
        input.destination.entityType,
        input.destination.entityId,
        input.destination.storageKey,
        input.fileName,
        input.mimeType,
        input.size,
        input.checksum,
        JSON.stringify(input.destination.context),
        expiresAt.toISOString(),
      ],
    )) as { rows: Array<{ id: string }> };
    await client.query("commit");
    return { id: inserted.rows[0].id, token, expiresAt };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimDirectUploadToken(token: string) {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = (await client.query(
      `select * from admin_image_upload_sessions where token_hash = $1 for update`,
      [hashDirectUploadToken(token)],
    )) as { rows: DirectUploadSessionRow[] };
    const session = result.rows[0];
    if (!session || session.status !== "AUTHORIZED" || new Date(session.expires_at) <= new Date()) {
      if (session?.status === "AUTHORIZED") {
        await client.query(
          "update admin_image_upload_sessions set status = 'EXPIRED', updated_at = now() where id = $1::uuid",
          [session.id],
        );
      }
      await client.query("commit");
      return null;
    }
    await client.query(
      `update admin_image_upload_sessions
       set status = 'UPLOADING', started_at = now(), updated_at = now()
       where id = $1::uuid`,
      [session.id],
    );
    await client.query("commit");
    return session;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordDirectUploadGatewayResult(input: {
  uploadId: string;
  ok: boolean;
  receivedBytes?: number;
  checksum?: string | null;
  failureReason?: string;
}) {
  const status = input.ok ? "UPLOADED" : "FAILED";
  const result = await dbQuery<{ id: string }>(
    `update admin_image_upload_sessions
     set status = $2,
         received_bytes = $3,
         received_checksum_sha256 = $4,
         uploaded_at = case when $2 = 'UPLOADED' then now() else uploaded_at end,
         failed_at = case when $2 = 'FAILED' then now() else failed_at end,
         failure_reason = $5,
         updated_at = now()
     where id = $1::uuid and status = 'UPLOADING'
     returning id`,
    [
      input.uploadId,
      status,
      input.receivedBytes ?? null,
      input.checksum ?? null,
      input.ok ? null : text(input.failureReason).slice(0, 500) || "Gateway upload failed.",
    ],
  );
  return result.rows[0] ?? null;
}

function customerFileResult(row: CustomerPrivateFileRow) {
  const metadata = row.metadata_json ?? {};
  return {
    id: row.id,
    customerId: row.customer_id,
    bookingId: row.booking_id,
    bookingPublicId: row.booking_public_id,
    documentType: row.document_type,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    source: typeof metadata.source === "string" ? metadata.source : "profile",
    createdAt: row.created_at,
    openUrl: `/api/admin/customers/${encodeURIComponent(row.customer_id)}/private-files/${encodeURIComponent(row.id)}`,
  };
}

export async function finalizeDirectUploadSession(input: {
  uploadId: string;
  userId: string;
}): Promise<DirectUploadFinalizationResult | null> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const selected = (await client.query(
      `select * from admin_image_upload_sessions
       where id = $1::uuid and user_id = $2::uuid
       for update`,
      [input.uploadId, input.userId],
    )) as { rows: DirectUploadSessionRow[] };
    const session = selected.rows[0];
    if (!session) {
      await client.query("rollback");
      return null;
    }
    if (session.status === "FINALIZED" && session.final_result_json) {
      await client.query("commit");
      return {
        purpose: session.purpose,
        entityId: session.entity_id,
        result: session.final_result_json,
        audit: null,
      };
    }
    if (session.status !== "UPLOADED") {
      throw new Error("The image has not finished uploading.");
    }
    if (Number(session.received_bytes) !== Number(session.expected_bytes)) {
      throw new Error("The stored image size does not match the authorized upload.");
    }
    if (session.checksum_sha256 && session.received_checksum_sha256 !== session.checksum_sha256) {
      throw new Error("The stored image checksum does not match the authorized upload.");
    }

    let result: Record<string, unknown>;
    let audit: DirectUploadFinalizationResult["audit"] = null;
    if (session.purpose === "VEHICLE_GALLERY" || session.purpose === "LANDING_CONTENT") {
      result = {
        url: buildBunnyPublicUrl(getBunnyStorageConfig("public"), session.storage_key),
        storageKey: session.storage_key,
        storageProvider: "BUNNY_STORAGE",
        originalFileName: session.original_file_name,
        mimeType: session.mime_type,
        sizeBytes: Number(session.expected_bytes),
      };
      if (session.purpose === "VEHICLE_GALLERY" && session.entity_id) {
        audit = {
          entityType: "vehicle",
          entityId: session.entity_id,
          context: "vehicle gallery",
        };
      }
    } else if (session.purpose === "CUSTOMER_LEGAL_ID" && session.entity_id) {
      const customerPublicId = text(session.context_json.customerPublicId) || session.entity_id;
      const inserted = (await client.query(
        `insert into booking_private_files (
           customer_id, booking_id, document_type, storage_provider, storage_key,
           original_file_name, mime_type, byte_size, metadata_json, created_by_user_id
         ) values ($1::uuid, null, $2, 'BUNNY_STORAGE', $3, $4, $5, $6, $7::jsonb, $8::uuid)
         returning id, customer_id, booking_id, null::text as booking_public_id,
           document_type, storage_provider, storage_key, original_file_name, mime_type,
           byte_size, metadata_json, created_by_user_id, created_at`,
        [
          session.entity_id,
          CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
          session.storage_key,
          session.original_file_name,
          session.mime_type,
          Number(session.expected_bytes),
          JSON.stringify({
            customerId: session.entity_id,
            customerPublicId,
            documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
            storageProvider: "BUNNY_STORAGE",
            source: "admin_customer_profile",
            uploadedByUserId: input.userId,
            uploadedAt: session.uploaded_at,
            originalFileName: session.original_file_name,
            mimeType: session.mime_type,
            byteSize: Number(session.expected_bytes),
            directUploadSessionId: session.id,
          }),
          input.userId,
        ],
      )) as { rows: CustomerPrivateFileRow[] };
      result = customerFileResult(inserted.rows[0]);
      audit = {
        entityType: "customer",
        entityId: session.entity_id,
        context: "customer legal identification",
      };
    } else if (session.purpose === "INSPECTION_IMAGE" && session.entity_id) {
      const type = inspectionType(session.context_json.inspectionType);
      const category = inspectionCategory(session.context_json.category);
      const inspectionId = requiredUuid(session.context_json.inspectionId, "Inspection ID");
      if (!type || !category) throw new Error("Inspection upload context is invalid.");
      const created = await createBookingVehicleInspectionImages(
        session.entity_id,
        {
          inspectionId,
          inspectionType: type,
          category,
          files: [{
            storageProvider: "BUNNY_STORAGE",
            storageKey: session.storage_key,
            originalFileName: session.original_file_name,
            mimeType: session.mime_type,
            sizeBytes: Number(session.expected_bytes),
          }],
          uploadedByUserId: input.userId,
        },
        { query: client.query.bind(client) as typeof dbQuery },
      );
      if (!created[0]) throw new Error("The inspection image target no longer exists.");
      result = { createdImage: created[0] };
      audit = {
        entityType: "booking",
        entityId: session.entity_id,
        context: `${type.toLowerCase()} inspection`,
      };
    } else {
      throw new Error("The upload destination is invalid.");
    }

    await client.query(
      `update admin_image_upload_sessions
       set status = 'FINALIZED', final_result_json = $2::jsonb, finalized_at = now(), updated_at = now()
       where id = $1::uuid`,
      [session.id, JSON.stringify(result)],
    );
    await client.query("commit");
    return { purpose: session.purpose, entityId: session.entity_id, result, audit };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

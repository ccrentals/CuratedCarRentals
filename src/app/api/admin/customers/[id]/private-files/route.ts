import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import {
  CUSTOMER_ID_IMAGE_POLICY,
  CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
  MAX_CUSTOMER_ID_IMAGES_PER_UPLOAD,
  type CustomerPrivateFileRow,
} from "@/lib/customers/privateFiles";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import {
  extractUploadcareFileId,
  normalizeUploadcareDeliveryUrl,
  UploadcareFileValidationError,
  validateUploadcareFiles,
} from "@/lib/uploads/uploadcare";
import {
  BunnyStorageError,
  createBunnyCustomerLegalIdStorageKey,
  deleteBunnyStorageObject,
  getBunnyStorageConfig,
  uploadBunnyStorageObject,
} from "@/lib/uploads/bunny";
import { getFileStorageProvider } from "@/lib/env";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";
import { validateRasterImageFile } from "@/lib/uploads/rasterImageValidation";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CustomerRow = {
  id: string;
  public_id: string | null;
};

type UploadedImage = File & { name: string; size: number; type: string };

function isUploadedImage(value: FormDataEntryValue): value is UploadedImage {
  return typeof value !== "string" && typeof value.name === "string" && typeof value.size === "number";
}

async function validateBunnyCustomerImages(files: UploadedImage[]) {
  if (files.length === 0) throw new BunnyStorageError("Select at least one valid ID image.", 400);
  if (files.length > MAX_CUSTOMER_ID_IMAGES_PER_UPLOAD) {
    throw new BunnyStorageError(
      `Customer ID images allow a maximum of ${MAX_CUSTOMER_ID_IMAGES_PER_UPLOAD} files per upload.`,
      400,
    );
  }
  for (const file of files) {
    if (file.size <= 0 || file.size > CUSTOMER_ID_IMAGE_POLICY.maxBytes) {
      throw new BunnyStorageError("Each customer ID image must be no larger than 10 MB.", 400);
    }
    const imageError = await validateRasterImageFile(file);
    if (imageError) throw new BunnyStorageError(imageError, 400);
  }
}

function jsonNoStore(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function mapFile(row: CustomerPrivateFileRow) {
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
    source:
      typeof metadata.source === "string" ? metadata.source : row.booking_id ? "booking" : "profile",
    createdAt: row.created_at,
    openUrl: `/api/admin/customers/${encodeURIComponent(row.customer_id)}/private-files/${encodeURIComponent(row.id)}`,
  };
}

async function loadCustomerFiles(customerId: string) {
  const result = await dbQuery<CustomerPrivateFileRow>(
    `select
       bpf.id,
       bpf.customer_id,
       bpf.booking_id,
       b.public_id as booking_public_id,
       bpf.document_type,
       bpf.storage_provider,
       bpf.storage_key,
       bpf.original_file_name,
       bpf.mime_type,
       bpf.byte_size,
       bpf.metadata_json,
       bpf.created_by_user_id,
       bpf.created_at
     from booking_private_files bpf
     left join bookings b on b.id = bpf.booking_id
     where bpf.customer_id = $1::uuid
       and bpf.document_type = $2
     order by bpf.created_at desc, bpf.id desc`,
    [customerId, CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE],
  );
  return result.rows;
}

async function saveBunnyCustomerImages(input: {
  customerId: string;
  files: UploadedImage[];
  userId: string;
}) {
  await validateBunnyCustomerImages(input.files);
  const config = getBunnyStorageConfig("private");
  const pool = getDbPool();
  const client = await pool.connect();
  const storedKeys: string[] = [];
  const insertedRows: CustomerPrivateFileRow[] = [];
  let customerPublicId: string | null = null;
  try {
    await client.query("begin");
    const customerResult = (await client.query(
      "select id, public_id from customers where id = $1::uuid for update",
      [input.customerId],
    )) as { rows: CustomerRow[] };
    const customer = customerResult.rows[0];
    if (!customer) {
      await client.query("rollback");
      return { customerPublicId, insertedRows, notFound: true };
    }
    customerPublicId = customer.public_id ?? customer.id;

    for (const file of input.files) {
      const storageKey = createBunnyCustomerLegalIdStorageKey({
        customerPublicId,
        fileName: file.name,
      });
      await uploadBunnyStorageObject(config, storageKey, file);
      storedKeys.push(storageKey);
      const uploadedAt = new Date().toISOString();
      const insertResult = (await client.query(
        `insert into booking_private_files (
           customer_id,
           booking_id,
           document_type,
           storage_provider,
           storage_key,
           original_file_name,
           mime_type,
           byte_size,
           metadata_json,
           created_by_user_id
         ) values (
           $1::uuid,
           null,
           $2,
           'BUNNY_STORAGE',
           $3,
           $4,
           $5,
           $6,
           $7::jsonb,
           $8::uuid
         )
         returning
           id,
           customer_id,
           booking_id,
           null::text as booking_public_id,
           document_type,
           storage_provider,
           storage_key,
           original_file_name,
           mime_type,
           byte_size,
           metadata_json,
           created_by_user_id,
           created_at`,
        [
          input.customerId,
          CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
          storageKey,
          file.name,
          file.type.trim().toLowerCase(),
          file.size,
          JSON.stringify({
            customerId: input.customerId,
            customerPublicId,
            documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
            storageProvider: "BUNNY_STORAGE",
            source: "admin_customer_profile",
            uploadedByUserId: input.userId,
            uploadedAt,
            originalFileName: file.name,
            mimeType: file.type.trim().toLowerCase(),
            byteSize: file.size,
          }),
          input.userId,
        ],
      )) as { rows: CustomerPrivateFileRow[] };
      insertedRows.push(insertResult.rows[0]);
    }
    await client.query("commit");
    return { customerPublicId, insertedRows, notFound: false };
  } catch (error) {
    await client.query("rollback");
    await Promise.allSettled(storedKeys.map((storageKey) => deleteBunnyStorageObject(config, storageKey)));
    throw error;
  } finally {
    client.release();
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const { id: customerId } = await params;
  if (!UUID_REGEX.test(customerId)) {
    return jsonNoStore({ ok: false, error: "Invalid customer ID." }, 400);
  }

  try {
    const customer = await dbQuery<{ id: string }>(
      "select id from customers where id = $1::uuid limit 1",
      [customerId],
    );
    if (!customer.rows[0]) {
      return jsonNoStore({ ok: false, error: "Customer not found." }, 404);
    }
    const files = await loadCustomerFiles(customerId);
    return jsonNoStore({ ok: true, items: files.map(mapFile) });
  } catch (error) {
    logError("api.admin.customers.private-files.GET", error, {
      customerId,
      userId: auth.actor.userId,
    });
    return jsonNoStore({ ok: false, error: "Failed to load customer ID images." }, 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const { id: customerId } = await params;
  if (!UUID_REGEX.test(customerId)) {
    return jsonNoStore({ ok: false, error: "Invalid customer ID." }, 400);
  }

  if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const csrfToken = form?.get("csrfToken");
    if (!(await requireCsrf(request, typeof csrfToken === "string" ? csrfToken : null))) {
      return jsonNoStore({ ok: false, error: "Invalid CSRF token." }, 403);
    }
    if (getFileStorageProvider() !== "bunny") {
      return jsonNoStore({ ok: false, error: "Private Bunny uploads are not active for this environment." }, 409);
    }
    const entries = form?.getAll("files") ?? [];
    const files = entries.filter(isUploadedImage);
    if (files.length !== entries.length) {
      return jsonNoStore({ ok: false, error: "Select at least one valid ID image." }, 400);
    }

    try {
      const saved = await saveBunnyCustomerImages({ customerId, files, userId: auth.actor.userId });
      if (saved.notFound) return jsonNoStore({ ok: false, error: "Customer not found." }, 404);
      for (const row of saved.insertedRows) {
        try {
          await writeMediaAudit({
            userId: auth.actor.userId,
            action: "MEDIA_UPLOAD",
            entityType: "customer",
            entityId: customerId,
            fileId: row.storage_key,
            context: "customer legal identification",
            label: row.original_file_name,
            outcome: "Saved privately to Bunny Storage",
            details: {
              privateFileId: row.id,
              customerPublicId: saved.customerPublicId,
              documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
              storageProvider: "BUNNY_STORAGE",
            },
          });
        } catch (auditError) {
          logError("api.admin.customers.private-files.POST.bunny-audit", auditError, {
            customerId,
            privateFileId: row.id,
          });
        }
      }
      return jsonNoStore({ ok: true, items: saved.insertedRows.map(mapFile) }, 201);
    } catch (error) {
      if (error instanceof BunnyStorageError) {
        return jsonNoStore({ ok: false, error: error.message }, error.status);
      }
      logError("api.admin.customers.private-files.POST.bunny", error, {
        customerId,
        userId: auth.actor.userId,
      });
      return jsonNoStore({ ok: false, error: "Failed to save customer ID images." }, 500);
    }
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await requireCsrf(request, typeof body?.csrfToken === "string" ? body.csrfToken : null))) {
    return jsonNoStore({ ok: false, error: "Invalid CSRF token." }, 403);
  }

  const rawReferences = Array.isArray(body?.files)
    ? body.files
    : Array.isArray(body?.fileIds)
      ? body.fileIds
      : [];
  const references = rawReferences
    .map((value) => extractUploadcareFileId(value))
    .filter((value): value is string => Boolean(value));
  if (references.length === 0 || references.length !== rawReferences.length) {
    return jsonNoStore({ ok: false, error: "Select at least one valid ID image." }, 400);
  }

  try {
    const metadata = await validateUploadcareFiles(references, CUSTOMER_ID_IMAGE_POLICY);
    const pool = getDbPool();
    const client = await pool.connect();
    const insertedRows: CustomerPrivateFileRow[] = [];
    let customerPublicId: string | null = null;
    try {
      await client.query("begin");
      const customerResult = (await client.query(
        "select id, public_id from customers where id = $1::uuid for update",
        [customerId],
      )) as { rows: CustomerRow[] };
      const customer = customerResult.rows[0];
      if (!customer) {
        await client.query("rollback");
        return jsonNoStore({ ok: false, error: "Customer not found." }, 404);
      }
      customerPublicId = customer.public_id;

      const fileIds = metadata.map((file) => file.uuid);
      const duplicateResult = (await client.query(
        `select storage_key
         from booking_private_files
         where customer_id = $1::uuid
           and document_type = $2
           and exists (
             select 1
             from unnest($3::text[]) as candidate(file_id)
             where storage_key ilike '%' || candidate.file_id || '%'
           )`,
        [customerId, CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE, fileIds],
      )) as { rows: Array<{ storage_key: string }> };
      if (duplicateResult.rows.length > 0) {
        await client.query("rollback");
        return jsonNoStore(
          { ok: false, error: "One or more selected images are already attached to this customer." },
          409,
        );
      }

      for (const [index, file] of metadata.entries()) {
        const uploadedAt = new Date().toISOString();
        const storageKey =
          file.originalFileUrl ??
          normalizeUploadcareDeliveryUrl(references[index]) ??
          file.uuid;
        const insertResult = (await client.query(
          `insert into booking_private_files (
             customer_id,
             booking_id,
             document_type,
             storage_provider,
             storage_key,
             original_file_name,
             mime_type,
             byte_size,
             metadata_json,
             created_by_user_id
           ) values (
             $1::uuid,
             null,
             $2,
             'UPLOADCARE_FILE_ID',
             $3,
             $4,
             $5,
             $6,
             $7::jsonb,
             $8::uuid
           )
           returning
             id,
             customer_id,
             booking_id,
             null::text as booking_public_id,
             document_type,
             storage_provider,
             storage_key,
             original_file_name,
             mime_type,
             byte_size,
             metadata_json,
             created_by_user_id,
             created_at`,
          [
            customerId,
            CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
            storageKey,
            file.originalFilename,
            file.mimeType,
            file.size,
            JSON.stringify({
              customerId,
              customerPublicId,
              documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
              source: "admin_customer_profile",
              bookingId: null,
              bookingPublicId: null,
              uploadedByUserId: auth.actor.userId,
              uploadedAt,
              originalFileName: file.originalFilename,
              mimeType: file.mimeType,
              byteSize: file.size,
            }),
            auth.actor.userId,
          ],
        )) as { rows: CustomerPrivateFileRow[] };
        insertedRows.push(insertResult.rows[0]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    for (const row of insertedRows) {
      try {
        await writeMediaAudit({
          userId: auth.actor.userId,
          action: "MEDIA_UPLOAD",
          entityType: "customer",
          entityId: customerId,
          fileId: row.storage_key,
          context: "customer legal identification",
          label: row.original_file_name,
          outcome: "Saved to customer profile",
          details: {
            privateFileId: row.id,
            customerPublicId,
            documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
          },
        });
      } catch (auditError) {
        logError("api.admin.customers.private-files.POST.audit", auditError, {
          customerId,
          privateFileId: row.id,
        });
      }
    }

    return jsonNoStore({ ok: true, items: insertedRows.map(mapFile) }, 201);
  } catch (error) {
    if (error instanceof UploadcareFileValidationError) {
      return jsonNoStore({ ok: false, error: error.message }, error.status);
    }
    logError("api.admin.customers.private-files.POST", error, {
      customerId,
      userId: auth.actor.userId,
    });
    try {
      await writeAuditLog({
        userId: auth.actor.userId,
        action: "CUSTOMER_PRIVATE_FILE_UPLOAD_FAILED",
        entityType: "customer",
        entityId: customerId,
        details: { documentType: CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE },
      });
    } catch {
      // Preserve the primary upload error.
    }
    return jsonNoStore({ ok: false, error: "Failed to save customer ID images." }, 500);
  }
}

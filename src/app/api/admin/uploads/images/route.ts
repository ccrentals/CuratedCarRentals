import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getFileStorageProvider } from "@/lib/env";
import { requireCsrf } from "@/lib/security/csrf";
import {
  buildBunnyPublicUrl,
  createBunnyStorageKey,
  createBunnyVehicleGalleryStorageKey,
  deleteBunnyStorageObject,
  getBunnyStorageConfig,
  uploadBunnyStorageObject,
  type BunnyStorageConfig,
} from "@/lib/uploads/bunny";
import { dbQuery } from "@/lib/db";

const MAX_IMAGE_COUNT = 20;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

type UploadFile = File & { name: string; size: number; type: string };

function isUploadFile(value: FormDataEntryValue): value is UploadFile {
  return typeof value !== "string" && typeof value.name === "string" && typeof value.size === "number";
}

function jsonNoStore(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

type AdminImageUploadRouteDeps = {
  requireUploadAccess: typeof requireOperationsAccess;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getProvider: typeof getFileStorageProvider;
  getPublicConfig: () => BunnyStorageConfig;
  createStorageKey: typeof createBunnyStorageKey;
  uploadObject: typeof uploadBunnyStorageObject;
  deleteObject: typeof deleteBunnyStorageObject;
  buildPublicUrl: typeof buildBunnyPublicUrl;
  getVehicleContext: (vehicleId: string) => Promise<{
    publicId: string;
    vehicleLabel: string;
    galleryCount: number;
  } | null>;
};

const DEFAULT_DEPS: AdminImageUploadRouteDeps = {
  requireUploadAccess: requireOperationsAccess,
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getProvider: getFileStorageProvider,
  getPublicConfig: () => getBunnyStorageConfig("public"),
  createStorageKey: createBunnyStorageKey,
  uploadObject: uploadBunnyStorageObject,
  deleteObject: deleteBunnyStorageObject,
  buildPublicUrl: buildBunnyPublicUrl,
  getVehicleContext: async (vehicleId) => {
    const result = await dbQuery<{
      public_id: string;
      make: string;
      model: string;
      gallery_count: number;
    }>(
      `select public_id, make, model, coalesce(jsonb_array_length(image_urls_json), 0)::int as gallery_count
       from vehicles
       where id = $1::uuid and deleted_at is null
       limit 1`,
      [vehicleId],
    );
    const vehicle = result.rows[0];
    return vehicle
      ? {
          publicId: vehicle.public_id,
          vehicleLabel: `${vehicle.make} ${vehicle.model}`,
          galleryCount: vehicle.gallery_count,
        }
      : null;
  },
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET() {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  return jsonNoStore({ provider: getFileStorageProvider() });
}

export async function handleAdminImageUploadPost(
  request: Request,
  deps: Partial<AdminImageUploadRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireUploadAccess();
  if (!auth.ok) return auth.response;

  const form = await request.formData().catch(() => null);
  if (!form) return jsonNoStore({ error: "Invalid upload request." }, 400);
  const csrfToken = form.get("csrfToken");
  if (!(await resolvedDeps.requireCsrfCheck(request, typeof csrfToken === "string" ? csrfToken : null))) {
    return jsonNoStore({ error: "Invalid CSRF token." }, 403);
  }
  if (resolvedDeps.getProvider() !== "bunny") {
    return jsonNoStore({ error: "Bunny uploads are not active for this environment." }, 409);
  }

  const entries = form.getAll("files");
  const files = entries.filter(isUploadFile);
  if (files.length === 0 || files.length !== entries.length) {
    return jsonNoStore({ error: "Select at least one image file." }, 400);
  }
  if (files.length > MAX_IMAGE_COUNT) {
    return jsonNoStore({ error: `A maximum of ${MAX_IMAGE_COUNT} images can be uploaded at once.` }, 400);
  }

  const vehicleId = form.get("vehicleId");
  let vehicleContext: Awaited<ReturnType<AdminImageUploadRouteDeps["getVehicleContext"]>> = null;
  if (typeof vehicleId === "string" && vehicleId.trim()) {
    if (!isUuid(vehicleId)) return jsonNoStore({ error: "Invalid vehicle upload context." }, 400);
    vehicleContext = await resolvedDeps.getVehicleContext(vehicleId);
    if (!vehicleContext) return jsonNoStore({ error: "Vehicle upload context was not found." }, 404);
  }

  for (const file of files) {
    const mimeType = file.type.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return jsonNoStore({ error: "Choose a JPG, PNG, WebP, HEIC, or HEIF image." }, 400);
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return jsonNoStore({ error: "Each image must be no larger than 10 MB." }, 400);
    }
  }

  let config: BunnyStorageConfig;
  try {
    config = resolvedDeps.getPublicConfig();
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "Bunny uploads are not configured." },
      503,
    );
  }

  const storedKeys: string[] = [];
  try {
    const items = [];
    for (const [fileIndex, file] of files.entries()) {
      const storageKey = vehicleContext
        ? createBunnyVehicleGalleryStorageKey({
            vehiclePublicId: vehicleContext.publicId,
            vehicleLabel: vehicleContext.vehicleLabel,
            position: vehicleContext.galleryCount + fileIndex + 1,
            fileName: file.name,
          })
        : resolvedDeps.createStorageKey({ scope: "public", fileName: file.name });
      await resolvedDeps.uploadObject(config, storageKey, file);
      storedKeys.push(storageKey);
      items.push({
        url: resolvedDeps.buildPublicUrl(config, storageKey),
        storageKey,
        storageProvider: "BUNNY_STORAGE",
        originalFileName: file.name,
        mimeType: file.type.trim().toLowerCase(),
        sizeBytes: file.size,
      });
    }
    return jsonNoStore({ ok: true, items });
  } catch (error) {
    await Promise.allSettled(storedKeys.map((storageKey) => resolvedDeps.deleteObject(config, storageKey)));
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "Unable to store images in Bunny." },
      502,
    );
  }
}

export async function POST(request: Request) {
  return handleAdminImageUploadPost(request);
}

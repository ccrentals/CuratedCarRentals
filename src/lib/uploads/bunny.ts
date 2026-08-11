import { randomUUID } from "node:crypto";

export type BunnyStorageScope = "public" | "private";

export type BunnyStorageConfig = {
  scope: BunnyStorageScope;
  storageZone: string;
  accessKey: string;
  endpoint: string;
  publicCdnUrl: string | null;
};

export class BunnyStorageError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "BunnyStorageError";
    this.status = status;
  }
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHttpsOrigin(value: string, label: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new BunnyStorageError(`${label} must be a valid HTTPS origin.`, 503);
  }
}

export function getBunnyPublicCdnUrl(environment: NodeJS.ProcessEnv = process.env) {
  const value = normalizeText(environment.BUNNY_PUBLIC_CDN_URL);
  return value ? normalizeHttpsOrigin(value, "BUNNY_PUBLIC_CDN_URL") : null;
}

export function extractBunnyPublicStorageKey(value: unknown, publicCdnUrl: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== publicCdnUrl ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => segment.includes("/") || segment.includes("\\\\"))) return null;
    const storageKey = normalizeBunnyStorageKey(segments.join("/"));
    return storageKey.startsWith("public/") ? storageKey : null;
  } catch {
    return null;
  }
}

export function normalizeBunnyStorageKey(value: unknown) {
  const key = normalizeText(value).replace(/^\/+/, "");
  if (!key || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new BunnyStorageError("Invalid Bunny storage key.", 400);
  }
  return key;
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, key: string) {
  const value = normalizeText(environment[key]);
  if (!value) throw new BunnyStorageError(`${key} is not configured.`, 503);
  return value;
}

export function getBunnyStorageConfig(
  scope: BunnyStorageScope,
  environment: NodeJS.ProcessEnv = process.env,
): BunnyStorageConfig {
  const prefix = scope === "public" ? "BUNNY_STORAGE_PUBLIC" : "BUNNY_STORAGE_PRIVATE";
  const endpoint = normalizeHttpsOrigin(
    normalizeText(environment.BUNNY_STORAGE_ENDPOINT) || "https://storage.bunnycdn.com",
    "BUNNY_STORAGE_ENDPOINT",
  );
  const publicCdnUrl =
    scope === "public"
      ? getBunnyPublicCdnUrl(environment) ??
        (() => {
          throw new BunnyStorageError("BUNNY_PUBLIC_CDN_URL is not configured.", 503);
        })()
      : null;

  return {
    scope,
    storageZone: requiredEnvironmentValue(environment, `${prefix}_ZONE`),
    accessKey: requiredEnvironmentValue(environment, `${prefix}_ACCESS_KEY`),
    endpoint,
    publicCdnUrl,
  };
}

export function buildBunnyStorageObjectUrl(config: BunnyStorageConfig, storageKey: string) {
  const key = normalizeBunnyStorageKey(storageKey);
  return `${config.endpoint}/${encodeURIComponent(config.storageZone)}/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function buildBunnyPublicUrl(config: BunnyStorageConfig, storageKey: string) {
  if (config.scope !== "public" || !config.publicCdnUrl) {
    throw new BunnyStorageError("A public Bunny CDN URL is not available for this storage scope.", 500);
  }
  const key = normalizeBunnyStorageKey(storageKey);
  return `${config.publicCdnUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function createBunnyStorageKey(input: {
  scope: BunnyStorageScope;
  fileName: string;
  now?: Date;
  id?: string;
}) {
  const rawName = normalizeText(input.fileName) || "upload.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "upload.bin";
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  return `${input.scope}/${date}/${input.id ?? randomUUID()}-${safeName}`;
}

export function createBunnyVehicleGalleryStorageKey(input: {
  vehiclePublicId: string;
  vehicleLabel: string;
  position: number;
  fileName: string;
  id?: string;
}) {
  const vehiclePublicId = normalizeText(input.vehiclePublicId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const vehicleSlug = normalizeText(input.vehicleLabel)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!vehiclePublicId || !vehicleSlug || !Number.isInteger(input.position) || input.position < 1) {
    throw new BunnyStorageError("Invalid Bunny vehicle gallery key.", 400);
  }
  const rawName = normalizeText(input.fileName) || "upload.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "upload.bin";
  return `public/vehicles/${vehiclePublicId}/${vehicleSlug}/gallery-${String(input.position).padStart(2, "0")}-${
    input.id ?? randomUUID()
  }-${safeName}`;
}

export function createBunnyCustomerLegalIdStorageKey(input: {
  customerPublicId: string;
  fileName: string;
  id?: string;
}) {
  const customerPublicId = normalizeText(input.customerPublicId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  if (!customerPublicId) {
    throw new BunnyStorageError("Invalid Bunny customer identification key.", 400);
  }
  const rawName = normalizeText(input.fileName) || "id-image.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "id-image.bin";
  return `private/customers/${customerPublicId}/drivers-license/${customerPublicId}-${input.id ?? randomUUID()}-${safeName}`;
}

export function createBunnyBookingInspectionStorageKey(input: {
  bookingId: string;
  inspectionType: "PICKUP" | "RETURN";
  category: string;
  fileName: string;
  id?: string;
}) {
  const bookingId = normalizeText(input.bookingId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const inspectionType = normalizeText(input.inspectionType).toLowerCase();
  const category = normalizeText(input.category)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!bookingId || !["pickup", "return"].includes(inspectionType) || !category) {
    throw new BunnyStorageError("Invalid Bunny inspection image key.", 400);
  }
  const rawName = normalizeText(input.fileName) || "inspection-image.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "inspection-image.bin";
  return `private/bookings/${bookingId}/inspections/${inspectionType}/${category}/${input.id ?? randomUUID()}-${safeName}`;
}

export function createBunnyVehicleDocumentStorageKey(input: {
  vehicleId: string;
  fileName: string;
  id?: string;
}) {
  const vehicleId = normalizeText(input.vehicleId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  if (!vehicleId) {
    throw new BunnyStorageError("Invalid Bunny vehicle document key.", 400);
  }
  const rawName = normalizeText(input.fileName) || "vehicle-document.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "vehicle-document.bin";
  return `private/vehicles/${vehicleId}/documents/${input.id ?? randomUUID()}-${safeName}`;
}

export function createBunnyBookingPrivateFileStorageKey(input: {
  bookingId: string;
  documentType: "DRIVERS_LICENSE" | "SIGNATURE";
  fileName: string;
  id?: string;
}) {
  const bookingId = normalizeText(input.bookingId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const documentType = normalizeText(input.documentType).toLowerCase().replace(/_/g, "-");
  if (!bookingId || !["drivers-license", "signature"].includes(documentType)) {
    throw new BunnyStorageError("Invalid Bunny booking private file key.", 400);
  }
  const rawName = normalizeText(input.fileName) || "booking-file.bin";
  const safeName = rawName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "booking-file.bin";
  return `private/bookings/${bookingId}/${documentType}/${input.id ?? randomUUID()}-${safeName}`;
}

type BunnyFetchOptions = {
  fetchFn?: typeof fetch;
};

export async function uploadBunnyStorageObject(
  config: BunnyStorageConfig,
  storageKey: string,
  body: BodyInit,
  options: BunnyFetchOptions = {},
) {
  const response = await (options.fetchFn ?? fetch)(buildBunnyStorageObjectUrl(config, storageKey), {
    method: "PUT",
    headers: { AccessKey: config.accessKey },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new BunnyStorageError("Bunny could not store the uploaded file.", response.status || 502);
  }
}

export async function fetchBunnyStorageObject(
  config: BunnyStorageConfig,
  storageKey: string,
  options: BunnyFetchOptions = {},
) {
  const response = await (options.fetchFn ?? fetch)(buildBunnyStorageObjectUrl(config, storageKey), {
    headers: { AccessKey: config.accessKey },
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new BunnyStorageError("Bunny could not load the requested file.", response.status || 502);
  }
  return response;
}

export async function deleteBunnyStorageObject(
  config: BunnyStorageConfig,
  storageKey: string,
  options: BunnyFetchOptions = {},
) {
  const response = await (options.fetchFn ?? fetch)(buildBunnyStorageObjectUrl(config, storageKey), {
    method: "DELETE",
    headers: { AccessKey: config.accessKey },
    cache: "no-store",
  });
  if (response.status === 404) return { alreadyDeleted: true };
  if (!response.ok) {
    throw new BunnyStorageError("Bunny could not delete the requested file.", response.status || 502);
  }
  return { alreadyDeleted: false };
}

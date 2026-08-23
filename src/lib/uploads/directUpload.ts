import { createHash, randomBytes } from "node:crypto";

export const DIRECT_UPLOAD_TOKEN_TTL_SECONDS = 10 * 60;
export * from "@/lib/uploads/directUploadPolicy";

export function createDirectUploadToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashDirectUploadToken(token) };
}

export function hashDirectUploadToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeSha256(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : null;
}

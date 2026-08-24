import * as BunnySDK from "npm:@bunny.net/edgescript-sdk@0.12.1";

type Claim = {
  ok: true;
  uploadId: string;
  scope: "public" | "private";
  storageKey: string;
  expectedBytes: number;
  mimeType: string;
  checksum: string | null;
};

class GatewayUploadError extends Error {
  clientMessage: string;
  responseStatus: number;

  constructor(message: string, clientMessage: string, responseStatus = 502) {
    super(message);
    this.name = "GatewayUploadError";
    this.clientMessage = clientMessage;
    this.responseStatus = responseStatus;
  }
}

const SIGNATURE_BYTES = 12;
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function hasBytes(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function imageSignatureMatches(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") return hasBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") {
    return hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    return ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12));
  }
  return false;
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function httpsOrigin(value: string, label: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a standalone HTTPS origin.`);
  }
  return url.origin;
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = env("UPLOAD_ALLOWED_ORIGINS")
    .split(",")
    .map((value) => httpsOrigin(value.trim(), "UPLOAD_ALLOWED_ORIGINS"));
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "PUT, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-upload-checksum",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

async function callback(path: string, payload: Record<string, unknown>) {
  return fetch(`${httpsOrigin(env("APP_ORIGIN"), "APP_ORIGIN")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-upload-gateway-secret": env("UPLOAD_GATEWAY_SHARED_SECRET"),
    },
    body: JSON.stringify(payload),
  });
}

function storageObjectUrl(scope: "public" | "private", storageKey: string) {
  const zone = env(scope === "public" ? "BUNNY_STORAGE_PUBLIC_ZONE" : "BUNNY_STORAGE_PRIVATE_ZONE");
  const endpoint = httpsOrigin(env("BUNNY_STORAGE_ENDPOINT"), "BUNNY_STORAGE_ENDPOINT");
  return `${endpoint}/${encodeURIComponent(zone)}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function compactResponseText(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 200);
}

async function bunnyStorageFailure(response: Response) {
  const detail = compactResponseText(await response.text().catch(() => ""));
  const diagnostic = `Bunny Storage rejected the upload with HTTP ${response.status}${detail ? `: ${detail}` : "."}`;
  if (response.status === 401 || response.status === 403) {
    return new GatewayUploadError(
      diagnostic,
      "Image storage authentication is misconfigured. Contact an administrator.",
      503,
    );
  }
  return new GatewayUploadError(
    diagnostic,
    "Image storage rejected the upload. Contact an administrator.",
  );
}

async function handle(request: Request) {
  const origin = allowedOrigin(request);
  if (!origin) return new Response("Origin not allowed", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token || !request.body) return new Response("Upload token and body are required", { status: 400, headers: corsHeaders(origin) });

  const claimResponse = await callback("/api/internal/uploads/direct/claim", { token });
  const claim = (await claimResponse.json().catch(() => null)) as Claim | null;
  if (!claimResponse.ok || !claim?.ok) {
    return new Response("Upload token is invalid or already used", { status: claimResponse.status || 409, headers: corsHeaders(origin) });
  }

  const contentLength = Number(request.headers.get("content-length"));
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  const checksum = request.headers.get("x-upload-checksum")?.trim().toUpperCase() || null;
  if (!Number.isSafeInteger(contentLength) || contentLength !== claim.expectedBytes || contentType !== claim.mimeType || checksum !== claim.checksum) {
    await callback("/api/internal/uploads/direct/result", { uploadId: claim.uploadId, ok: false, failureReason: "Upload metadata did not match its authorization." });
    return new Response("Upload metadata mismatch", { status: 400, headers: corsHeaders(origin) });
  }

  let receivedBytes = 0;
  let signaturePrefix = new Uint8Array(0);
  let signatureValidated = false;
  const countedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > claim.expectedBytes) throw new Error("Upload exceeded its authorized size.");
      if (signatureValidated) {
        controller.enqueue(chunk);
        return;
      }

      const take = Math.min(SIGNATURE_BYTES - signaturePrefix.byteLength, chunk.byteLength);
      const nextPrefix = new Uint8Array(signaturePrefix.byteLength + take);
      nextPrefix.set(signaturePrefix);
      nextPrefix.set(chunk.slice(0, take), signaturePrefix.byteLength);
      signaturePrefix = nextPrefix;
      if (signaturePrefix.byteLength < SIGNATURE_BYTES) return;
      if (!imageSignatureMatches(signaturePrefix, claim.mimeType)) {
        throw new Error("Upload contents did not match the authorized image type.");
      }
      signatureValidated = true;
      controller.enqueue(signaturePrefix);
      if (take < chunk.byteLength) controller.enqueue(chunk.slice(take));
    },
    flush(controller) {
      if (signatureValidated) return;
      if (!imageSignatureMatches(signaturePrefix, claim.mimeType)) {
        throw new Error("Upload contents did not match the authorized image type.");
      }
      signatureValidated = true;
      controller.enqueue(signaturePrefix);
    },
  }));

  const accessKey = env(claim.scope === "public" ? "BUNNY_STORAGE_PUBLIC_ACCESS_KEY" : "BUNNY_STORAGE_PRIVATE_ACCESS_KEY");
  try {
    const bunnyResponse = await fetch(storageObjectUrl(claim.scope, claim.storageKey), {
      method: "PUT",
      headers: {
        AccessKey: accessKey,
        "content-type": claim.mimeType,
        ...(claim.checksum ? { Checksum: claim.checksum } : {}),
      },
      body: countedBody,
    });
    if (!bunnyResponse.ok) throw await bunnyStorageFailure(bunnyResponse);
    if (receivedBytes !== claim.expectedBytes) {
      throw new GatewayUploadError(
        `Gateway received ${receivedBytes} of ${claim.expectedBytes} authorized bytes.`,
        "The image upload ended before all bytes were stored. Please retry.",
      );
    }
    const resultResponse = await callback("/api/internal/uploads/direct/result", {
      uploadId: claim.uploadId,
      ok: true,
      receivedBytes,
      checksum: claim.checksum,
    });
    if (!resultResponse.ok) throw new Error("Unable to record upload completion.");
    return Response.json({ ok: true, uploadId: claim.uploadId }, { status: 201, headers: corsHeaders(origin) });
  } catch (error) {
    const gatewayError = error instanceof GatewayUploadError ? error : null;
    const failureReason = error instanceof Error ? error.message : "Gateway upload failed.";
    console.error(JSON.stringify({
      event: "direct_upload_failed",
      uploadId: claim.uploadId,
      scope: claim.scope,
      expectedBytes: claim.expectedBytes,
      receivedBytes,
      failureReason,
    }));
    await fetch(storageObjectUrl(claim.scope, claim.storageKey), { method: "DELETE", headers: { AccessKey: accessKey } }).catch(() => null);
    await callback("/api/internal/uploads/direct/result", {
      uploadId: claim.uploadId,
      ok: false,
      failureReason,
    }).catch(() => null);
    return new Response(gatewayError?.clientMessage ?? "Unable to store image", {
      status: gatewayError?.responseStatus ?? 502,
      headers: corsHeaders(origin),
    });
  }
}

BunnySDK.net.http.serve(handle);

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

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = env("UPLOAD_ALLOWED_ORIGINS").split(",").map((value) => value.trim());
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
  return fetch(`${env("APP_ORIGIN").replace(/\/+$/, "")}${path}`, {
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
  const endpoint = env("BUNNY_STORAGE_ENDPOINT").replace(/\/+$/, "");
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
  const countedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > claim.expectedBytes) throw new Error("Upload exceeded its authorized size.");
      controller.enqueue(chunk);
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

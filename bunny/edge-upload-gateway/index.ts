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
    if (!bunnyResponse.ok || receivedBytes !== claim.expectedBytes) throw new Error(`Bunny upload failed with ${bunnyResponse.status}.`);
    const resultResponse = await callback("/api/internal/uploads/direct/result", {
      uploadId: claim.uploadId,
      ok: true,
      receivedBytes,
      checksum: claim.checksum,
    });
    if (!resultResponse.ok) throw new Error("Unable to record upload completion.");
    return Response.json({ ok: true, uploadId: claim.uploadId }, { status: 201, headers: corsHeaders(origin) });
  } catch (error) {
    await fetch(storageObjectUrl(claim.scope, claim.storageKey), { method: "DELETE", headers: { AccessKey: accessKey } }).catch(() => null);
    await callback("/api/internal/uploads/direct/result", {
      uploadId: claim.uploadId,
      ok: false,
      failureReason: error instanceof Error ? error.message : "Gateway upload failed.",
    }).catch(() => null);
    return new Response("Unable to store image", { status: 502, headers: corsHeaders(origin) });
  }
}

BunnySDK.net.http.serve(handle);

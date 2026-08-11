import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { createUploadcareSignedUploadCredentials } from "@/lib/uploads/uploadcare";

type UploadcareSignatureRouteDeps = {
  requireUploadAccess: typeof requireOperationsAccess;
  createCredentials: typeof createUploadcareSignedUploadCredentials;
};

const DEFAULT_DEPS: UploadcareSignatureRouteDeps = {
  requireUploadAccess: requireOperationsAccess,
  createCredentials: createUploadcareSignedUploadCredentials,
};

export async function handleAdminUploadcareSignatureGet(
  deps: Partial<UploadcareSignatureRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireUploadAccess();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(resolvedDeps.createCredentials(), {
      headers: {
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Uploadcare signed uploads are not configured." },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
        },
      },
    );
  }
}

export async function GET() {
  return handleAdminUploadcareSignatureGet();
}

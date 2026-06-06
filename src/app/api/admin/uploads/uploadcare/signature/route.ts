import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { createUploadcareSignedUploadCredentials } from "@/lib/uploads/uploadcare";

export async function GET() {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(createUploadcareSignedUploadCredentials(), {
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

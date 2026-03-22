import { NextResponse } from "next/server";

export async function handleAdminMessagesRetentionPost(request?: Request) {
  void request;
  return NextResponse.json(
    {
      ok: false,
      error: "Manual Trash workflow is enabled. Automatic 30-day trash is disabled.",
    },
    { status: 410 },
  );
}

export async function POST(request: Request) {
  return handleAdminMessagesRetentionPost(request);
}

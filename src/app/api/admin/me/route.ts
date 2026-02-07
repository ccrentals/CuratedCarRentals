import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    userId: session.userId,
    role: session.role,
  });
}

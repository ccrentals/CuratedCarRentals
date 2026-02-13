import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export async function GET() {
  try {
    const r = await dbQuery<{ ok: number }>("select 1 as ok");
    return NextResponse.json({ ok: true, result: r.rows[0]?.ok ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

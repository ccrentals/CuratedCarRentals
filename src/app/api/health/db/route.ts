import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export async function GET() {
  try {
    const r = await dbQuery<{ ok: number }>("select 1 as ok");
    return NextResponse.json({ ok: true, result: r.rows[0]?.ok ?? null });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { deleteBunnyStorageObject, getBunnyStorageConfig } from "@/lib/uploads/bunny";

type CleanupCandidate = {
  id: string;
  storage_scope: "public" | "private";
  storage_key: string;
};

const BATCH_SIZE = 20;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  return Boolean(expected && request.headers.get("x-cron-secret") === expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const claimed = await dbQuery<CleanupCandidate>(
      `with candidates as (
         select id
         from admin_image_upload_sessions
         where (status in ('AUTHORIZED', 'FAILED') and expires_at < now())
            or (status = 'UPLOADING' and started_at < now() - interval '2 hours')
            or (status = 'UPLOADED' and uploaded_at < now() - interval '1 hour')
            or status = 'CLEANUP_PENDING'
         order by expires_at asc
         limit $1::int
         for update skip locked
       )
       update admin_image_upload_sessions session
       set status = 'CLEANUP_PENDING', updated_at = now()
       from candidates
       where session.id = candidates.id
       returning session.id, session.storage_scope, session.storage_key`,
      [BATCH_SIZE],
    );
    const outcomes = await Promise.all(claimed.rows.map(async (candidate: CleanupCandidate) => {
      try {
        await deleteBunnyStorageObject(
          getBunnyStorageConfig(candidate.storage_scope),
          candidate.storage_key,
        );
        await dbQuery(
          `update admin_image_upload_sessions
           set status = 'EXPIRED', failure_reason = null, updated_at = now()
           where id = $1::uuid and status = 'CLEANUP_PENDING'`,
          [candidate.id],
        );
        return true;
      } catch (error) {
        await dbQuery(
          `update admin_image_upload_sessions
           set failure_reason = $2, updated_at = now()
           where id = $1::uuid and status = 'CLEANUP_PENDING'`,
          [candidate.id, error instanceof Error ? error.message.slice(0, 500) : "Cleanup failed."],
        );
        logError("cron.direct-image-upload-cleanup.object", error, { uploadId: candidate.id });
        return false;
      }
    }));
    const deleted = outcomes.filter(Boolean).length;
    const failed = outcomes.length - deleted;
    return NextResponse.json({ ok: failed === 0, claimed: claimed.rows.length, deleted, failed });
  } catch (error) {
    logError("cron.direct-image-upload-cleanup", error, {});
    return NextResponse.json({ ok: false, error: "Direct upload cleanup failed." }, { status: 500 });
  }
}

import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { extractUploadcareFileId } from "@/lib/uploads/uploadcare";

export const MEDIA_AUDIT_ACTIONS = [
  "MEDIA_UPLOAD",
  "MEDIA_REMOVE",
  "MEDIA_PROVIDER_DELETE",
  "MEDIA_SHARED_PRESERVE",
  "MEDIA_CLEANUP_FAILED",
  "MEDIA_ORPHAN_DELETE",
] as const;

export type MediaAuditAction = (typeof MEDIA_AUDIT_ACTIONS)[number];

export type MediaAuditActivity = {
  id: string;
  action: MediaAuditAction;
  actorEmail: string | null;
  createdAt: string;
  fileId: string | null;
  context: string | null;
  label: string | null;
  outcome: string | null;
};

type MediaAuditRow = {
  id: string;
  action: MediaAuditAction;
  actor_email: string | null;
  created_at: string;
  file_id: string | null;
  context: string | null;
  label: string | null;
  outcome: string | null;
};

export async function writeMediaAudit(input: {
  userId?: string | null;
  action: MediaAuditAction;
  entityType: "vehicle" | "booking" | "customer" | "uploadcare_file";
  entityId?: string;
  fileId?: string | null;
  context: string;
  label?: string | null;
  outcome?: string | null;
  details?: Record<string, unknown>;
}) {
  const fileId = extractUploadcareFileId(input.fileId);
  await writeAuditLog({
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: {
      ...input.details,
      fileId,
      context: input.context,
      label: input.label ?? null,
      outcome: input.outcome ?? null,
    },
  });
}

export async function loadMediaAuditHistory(input: {
  entityType: "vehicle" | "booking" | "customer";
  entityId: string;
  limit?: number;
}): Promise<MediaAuditActivity[]> {
  const result = await dbQuery<MediaAuditRow>(
    `select
       a.id,
       a.action,
       u.email as actor_email,
       a.created_at,
       a.details_json->>'fileId' as file_id,
       a.details_json->>'context' as context,
       a.details_json->>'label' as label,
       a.details_json->>'outcome' as outcome
     from audit_logs a
     left join users u on u.id = a.user_id
     where a.entity_type = $1
       and a.entity_id = $2
       and a.action = any($3::text[])
     order by a.created_at desc
     limit $4::int`,
    [input.entityType, input.entityId, MEDIA_AUDIT_ACTIONS, input.limit ?? 12],
  );

  return result.rows.map((row: MediaAuditRow) => ({
    id: row.id,
    action: row.action,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
    fileId: extractUploadcareFileId(row.file_id),
    context: row.context,
    label: row.label,
    outcome: row.outcome,
  }));
}

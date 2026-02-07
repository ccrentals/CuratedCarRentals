import { dbQuery } from "@/lib/db";

type AuditLogInput = {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

export async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId,
  details = {},
}: AuditLogInput) {
  await dbQuery(
    "insert into audit_logs (user_id, action, entity_type, entity_id, details_json) values ($1, $2, $3, $4, $5)",
    [userId, action, entityType, entityId ?? null, details],
  );
}

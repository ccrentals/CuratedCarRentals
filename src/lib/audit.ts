import { dbQuery } from "@/lib/db";

type AuditLogInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

function normalizeUserId(value?: string | null) {
  if (!value) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) return null;
  return value;
}

export async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId,
  details = {},
}: AuditLogInput) {
  const normalizedUserId = normalizeUserId(userId);
  if (userId && !normalizedUserId) {
    console.warn(`Audit log user_id invalid, storing null for ${action}`, {
      entityType,
      entityId,
    });
  }
  await dbQuery(
    "insert into audit_logs (user_id, action, entity_type, entity_id, details_json) values ($1, $2, $3, $4, $5)",
    [normalizedUserId, action, entityType, entityId ?? null, details],
  );
}

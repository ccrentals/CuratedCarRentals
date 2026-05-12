import { dbQuery } from "@/lib/db";

type QueryResult<T = unknown> = Promise<{ rows: T[]; rowCount?: number }>;

export type MailboxQueryClient = {
  query: <T = unknown>(text: string, params?: unknown[]) => QueryResult<T>;
};

type ContactMessagesColumnRow = {
  column_name: string;
};

export type MailboxSchemaCapabilities = {
  hasSubject: boolean;
  hasDisplayName: boolean;
  hasDisplayEmail: boolean;
  hasMessageType: boolean;
  hasPriority: boolean;
  hasRelatedEntityType: boolean;
  hasRelatedEntityId: boolean;
  hasRelatedEntityPublicId: boolean;
  hasNotificationEligible: boolean;
  hasMetadataJson: boolean;
};

export type InsertMailboxMessageInput = {
  name: string;
  email: string;
  message: string;
  source: string;
  subject?: string | null;
  displayName?: string | null;
  displayEmail?: string | null;
  messageType?: string | null;
  priority?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  relatedEntityPublicId?: string | null;
  notificationEligible?: boolean;
  metadataJson?: Record<string, unknown> | null;
};

type InsertMailboxMessageRow = {
  id: string;
  created_at: string | Date;
};

const CONTACT_MESSAGES_TABLE = "contact_messages";
const CONTACT_MESSAGES_COLUMN_NAMES = [
  "subject",
  "display_name",
  "display_email",
  "message_type",
  "priority",
  "related_entity_type",
  "related_entity_id",
  "related_entity_public_id",
  "notification_eligible",
  "metadata_json",
] as const;

let schemaCapabilitiesPromise: Promise<MailboxSchemaCapabilities> | null = null;

function isDbQueryClient(client: MailboxQueryClient | typeof dbQuery): client is typeof dbQuery {
  return typeof client === "function";
}

function queryWithClient<T>(
  client: MailboxQueryClient | typeof dbQuery,
  text: string,
  params: unknown[] = [],
): QueryResult<T> {
  if (isDbQueryClient(client)) {
    return client<T>(text, params);
  }
  return client.query<T>(text, params);
}

function mapSourceToFallbackMessageType(source: string) {
  if (source === "home_page_contact") return "home_contact_inquiry";
  if (source === "booking_inspection") return "inspection_alert";
  if (source === "resend_webhook") return "email_delivery_issue";
  return "contact_inquiry";
}

export function getFallbackMessageTypeFromSource(source: unknown) {
  return mapSourceToFallbackMessageType(String(source ?? "").trim().toLowerCase());
}

export async function loadMailboxSchemaCapabilities(
  client: MailboxQueryClient | typeof dbQuery = dbQuery,
): Promise<MailboxSchemaCapabilities> {
  if (client === dbQuery && schemaCapabilitiesPromise) {
    return schemaCapabilitiesPromise;
  }

  const load = (async () => {
    const result = await queryWithClient<ContactMessagesColumnRow>(
      client,
      `select column_name
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = $1
          and column_name = any($2::text[])`,
      [CONTACT_MESSAGES_TABLE, [...CONTACT_MESSAGES_COLUMN_NAMES]],
    );

    const names = new Set(
      result.rows.map((row) => String(row.column_name ?? "").trim().toLowerCase()),
    );

    return {
      hasSubject: names.has("subject"),
      hasDisplayName: names.has("display_name"),
      hasDisplayEmail: names.has("display_email"),
      hasMessageType: names.has("message_type"),
      hasPriority: names.has("priority"),
      hasRelatedEntityType: names.has("related_entity_type"),
      hasRelatedEntityId: names.has("related_entity_id"),
      hasRelatedEntityPublicId: names.has("related_entity_public_id"),
      hasNotificationEligible: names.has("notification_eligible"),
      hasMetadataJson: names.has("metadata_json"),
    } satisfies MailboxSchemaCapabilities;
  })();

  if (client === dbQuery) {
    schemaCapabilitiesPromise = load;
  }

  return load;
}

export function buildMailboxSelectFields(
  alias: string,
  capabilities: MailboxSchemaCapabilities,
) {
  const fallbackTypeSql = `case coalesce(${alias}.source, 'contact_page')
    when 'home_page_contact' then 'home_contact_inquiry'
    when 'booking_inspection' then 'inspection_alert'
    when 'resend_webhook' then 'email_delivery_issue'
    else 'contact_inquiry'
  end`;

  return [
    `${alias}.id`,
    `${alias}.created_at`,
    `${alias}.name`,
    `${alias}.email`,
    `${alias}.message`,
    `${alias}.status`,
    `${alias}.read_at`,
    `${alias}.read_by_user_id`,
    `${alias}.source`,
    capabilities.hasSubject ? `${alias}.subject` : `null::text as subject`,
    capabilities.hasDisplayName ? `${alias}.display_name` : `null::text as display_name`,
    capabilities.hasDisplayEmail ? `${alias}.display_email` : `null::text as display_email`,
    capabilities.hasMessageType
      ? `${alias}.message_type`
      : `${fallbackTypeSql} as message_type`,
    capabilities.hasPriority ? `${alias}.priority` : `'normal'::text as priority`,
    capabilities.hasRelatedEntityType
      ? `${alias}.related_entity_type`
      : `null::text as related_entity_type`,
    capabilities.hasRelatedEntityId
      ? `${alias}.related_entity_id`
      : `null::text as related_entity_id`,
    capabilities.hasRelatedEntityPublicId
      ? `${alias}.related_entity_public_id`
      : `null::text as related_entity_public_id`,
    capabilities.hasNotificationEligible
      ? `${alias}.notification_eligible`
      : `false as notification_eligible`,
    capabilities.hasMetadataJson ? `${alias}.metadata_json` : `'{}'::jsonb as metadata_json`,
  ].join(",\n        ");
}

export async function insertMailboxMessage(
  client: MailboxQueryClient | typeof dbQuery,
  input: InsertMailboxMessageInput,
) {
  const capabilities = await loadMailboxSchemaCapabilities(client);

  const columns = ["name", "email", "message", "source"];
  const values: unknown[] = [input.name, input.email, input.message, input.source];

  function pushColumn(name: string, enabled: boolean, value: unknown) {
    if (!enabled) return;
    columns.push(name);
    values.push(value);
  }

  pushColumn("subject", capabilities.hasSubject, input.subject ?? null);
  pushColumn("display_name", capabilities.hasDisplayName, input.displayName ?? null);
  pushColumn("display_email", capabilities.hasDisplayEmail, input.displayEmail ?? null);
  pushColumn(
    "message_type",
    capabilities.hasMessageType,
    input.messageType ?? getFallbackMessageTypeFromSource(input.source),
  );
  pushColumn("priority", capabilities.hasPriority, input.priority ?? "normal");
  pushColumn("related_entity_type", capabilities.hasRelatedEntityType, input.relatedEntityType ?? null);
  pushColumn("related_entity_id", capabilities.hasRelatedEntityId, input.relatedEntityId ?? null);
  pushColumn(
    "related_entity_public_id",
    capabilities.hasRelatedEntityPublicId,
    input.relatedEntityPublicId ?? null,
  );
  pushColumn(
    "notification_eligible",
    capabilities.hasNotificationEligible,
    Boolean(input.notificationEligible),
  );
  pushColumn("metadata_json", capabilities.hasMetadataJson, input.metadataJson ?? {});

  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await queryWithClient<InsertMailboxMessageRow>(
    client,
    `insert into contact_messages (${columns.join(", ")})
      values (${placeholders.join(", ")})
      returning id, created_at`,
    values,
  );

  return (result.rows[0] as InsertMailboxMessageRow | undefined) ?? null;
}

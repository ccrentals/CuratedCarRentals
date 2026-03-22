import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { getSessionFromRequest, type AdminSession } from "@/lib/auth/session";
import {
  fetchAdminMessageExportRows,
  type AdminMessageExportRow,
} from "@/lib/messages/adminMessages";
import { readSortFromSearchParams } from "@/components/admin/tableSort";

function csvEscape(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/\"/g, '""')}"`;
  }
  return value;
}

export type AdminMessagesExportRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getRows: (input: {
    status?: string | null;
    source?: string | null;
    q?: string | null;
    sortBy?: string | null;
    sortDir?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  }) => Promise<AdminMessageExportRow[]>;
};

const DEFAULT_DEPS: AdminMessagesExportRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getRows: (input) => fetchAdminMessageExportRows(input),
};

export async function handleAdminMessagesExportGet(
  request: Request,
  deps: AdminMessagesExportRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({
    getSession: deps.getSession,
    responseFormat: "text",
  });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const sortState = readSortFromSearchParams(searchParams, {
    allowedSortBy: ["received", "name", "email", "status"],
    defaultSortBy: "received",
    defaultSortDir: "desc",
  });

  const rows = await deps.getRows({
    status: searchParams.get("status"),
    source: searchParams.get("source"),
    q: searchParams.get("q"),
    sortBy: sortState.sortBy,
    sortDir: sortState.sortDir,
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
  });

  const encoder = new TextEncoder();
  const filename = `messages-${new Date().toISOString().slice(0, 10)}.csv`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          "id,created_at,inbox_state,source_key,source_label,related_entity_type,related_entity_public_id,related_entity_label,display_name,display_email,message,read_at\n",
        ),
      );

      for (const row of rows) {
        const line = [
          row.id,
          row.createdAt,
          row.statusLabel,
          row.sourceKey,
          row.sourceLabel,
          row.relatedEntityType ?? "",
          row.relatedEntityPublicId ?? "",
          row.relatedEntityLabel ?? "",
          row.displayName,
          row.displayEmail,
          row.message,
          row.readAt ?? "",
        ]
          .map((value) => csvEscape(String(value ?? "")))
          .join(",");

        controller.enqueue(encoder.encode(`${line}\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  return handleAdminMessagesExportGet(request);
}

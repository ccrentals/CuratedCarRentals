import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  ADMIN_MESSAGE_SORT_COLUMNS,
  normalizeAdminMessageSortBy,
  normalizeAdminMessageSortDir,
  normalizeContactMessageStatusFilter,
} from "@/lib/messages/adminMessages";
import { readSortFromSearchParams } from "@/components/admin/tableSort";

type ExportRow = {
  created_at: string;
  status: string;
  name: string;
  email: string;
  message: string;
  read_at: string | null;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function csvEscape(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/\"/g, '""')}"`;
  }
  return value;
}

function isIsoDate(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function messageSnippet(value: string, maxLength = 240) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = normalizeContactMessageStatusFilter(searchParams.get("status"));
  const q = searchParams.get("q")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? null;
  const dateTo = searchParams.get("dateTo")?.trim() ?? null;
  const sortState = readSortFromSearchParams(searchParams, {
    allowedSortBy: ADMIN_MESSAGE_SORT_COLUMNS,
    defaultSortBy: "received",
    defaultSortDir: "desc",
  });
  const sortBy = normalizeAdminMessageSortBy(sortState.sortBy) ?? "received";
  const sortDir = normalizeAdminMessageSortDir(sortState.sortDir) ?? "desc";
  const direction = sortDir === "asc" ? "asc" : "desc";
  const orderBySql =
    sortBy === "name"
      ? `order by lower(name) ${direction}, id::text ${direction}`
      : sortBy === "email"
        ? `order by lower(email) ${direction}, id::text ${direction}`
        : sortBy === "status"
          ? `order by upper(status) ${direction}, id::text ${direction}`
          : `order by created_at ${direction}, id::text ${direction}`;

  const conditions: string[] = [];
  const values: Array<string | number> = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx}`);
    values.push(status);
    idx += 1;
  }

  if (q) {
    conditions.push(`(name ilike $${idx} or email ilike $${idx} or message ilike $${idx})`);
    values.push(`%${q}%`);
    idx += 1;
  }

  if (isIsoDate(dateFrom)) {
    conditions.push(`created_at >= $${idx}::date`);
    values.push(dateFrom);
    idx += 1;
  }

  if (isIsoDate(dateTo)) {
    conditions.push(`created_at < ($${idx}::date + interval '1 day')`);
    values.push(dateTo);
    idx += 1;
  }

  const where = conditions.length > 0 ? ` where ${conditions.join(" and ")}` : "";

  const result = await dbQuery<ExportRow>(
    `select created_at, status, name, email, message, read_at from contact_messages${where} ${orderBySql}`,
    values,
  );

  const encoder = new TextEncoder();
  const filename = `messages-${new Date().toISOString().slice(0, 10)}.csv`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode("created_at,status,name,email,message_snippet,read_at\n"),
      );

      for (const row of result.rows) {
        const line = [
          row.created_at,
          row.status,
          row.name,
          row.email,
          messageSnippet(row.message),
          row.read_at ?? "",
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

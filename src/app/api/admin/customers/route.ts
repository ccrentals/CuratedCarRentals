import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";

type CustomerListRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeSort(value: string | null): "last_booked" | "total_bookings" | "total_spend" {
  if (value === "total_bookings") return "total_bookings";
  if (value === "total_spend") return "total_spend";
  return "last_booked";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function createCsv(rows: CustomerListRow[]) {
  const headers = [
    "id",
    "full_name",
    "email",
    "phone",
    "total_bookings",
    "total_spend",
    "last_booked_at",
    "created_at",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.full_name,
        row.email,
        row.phone,
        row.total_bookings,
        row.total_spend,
        row.last_booked_at ?? "",
        row.created_at,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.toLowerCase().includes(column.toLowerCase());
}

async function fetchCustomers({
  q,
  sort,
}: {
  q: string;
  sort: "last_booked" | "total_bookings" | "total_spend";
}) {
  const whereSql = q
    ? "where c.full_name ilike $1 or c.email ilike $1 or c.phone ilike $1"
    : "";
  const values = q ? [`${q}%`] : [];

  const orderBy =
    sort === "total_bookings"
      ? "order by total_bookings desc, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc"
      : sort === "total_spend"
        ? "order by total_spend desc, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc"
        : "order by coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc";

  const withDeletedAware =
    "select c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
    whereSql +
    " group by c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at " +
    orderBy;

  try {
    return await dbQuery<CustomerListRow>(withDeletedAware, values);
  } catch (error) {
    if (!isMissingColumn(error, "deleted_at")) {
      throw error;
    }
    const fallback =
      "select c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
      whereSql +
      " group by c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at " +
      orderBy;
    try {
      return await dbQuery<CustomerListRow>(fallback, values);
    } catch (secondError) {
      if (!isMissingColumn(secondError, "last_booked_at")) throw secondError;
      const fallbackWithoutLastBooked =
        "select c.id, c.full_name, c.email, c.phone, c.created_at, null::timestamptz as last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
        whereSql +
        " group by c.id, c.full_name, c.email, c.phone, c.created_at " +
        orderBy.replace(/c\.last_booked_at, /g, "");
      return await dbQuery<CustomerListRow>(fallbackWithoutLastBooked, values);
    }
  }
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const sort = normalizeSort(url.searchParams.get("sort"));
  const exportMode = (url.searchParams.get("export") ?? "").toLowerCase();

  const result = await fetchCustomers({ q, sort });
  if (exportMode === "csv") {
    const csv = createCsv(result.rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="customers.csv"',
      },
    });
  }

  return NextResponse.json({ customers: result.rows });
}

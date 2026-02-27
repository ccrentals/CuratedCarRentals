import { dbQuery } from "@/lib/db";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";

function csvEscape(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

type ExportRow = {
  id: string;
  public_id: string;
  booking_id: string;
  booking_public_id: string | null;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

const PAYMENT_SORT_COLUMNS = [
  "payment",
  "booking",
  "customer",
  "vehicle",
  "provider",
  "status",
  "amount",
  "created",
] as const;
type PaymentSortBy = (typeof PAYMENT_SORT_COLUMNS)[number];
type PaymentSortDir = SortDir;

export async function GET(request: Request) {
  const auth = await requireAdminRole({ responseFormat: "text" });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const bookingId = searchParams.get("bookingId")?.trim();
  const paymentType = searchParams.get("paymentType")?.trim();
  const normalizedType = paymentType === "balance" ? "balance" : paymentType === "deposit" ? "deposit" : "";
  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: PAYMENT_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  }) as { sortBy: PaymentSortBy; sortDir: PaymentSortDir };
  const sortBy: PaymentSortBy = sort.sortBy ?? "created";
  const sortDir: PaymentSortDir = sort.sortDir ?? "desc";
  const directionSql = sortDir === "asc" ? "asc" : "desc";

  const conditions: string[] = [];
  const values: string[] = [];
  if (q) {
    values.push(`${q}%`);
    conditions.push(
      `(c.full_name ilike $${values.length} or c.email ilike $${values.length} or c.phone ilike $${values.length} or b.id::text ilike $${values.length} or b.public_id ilike $${values.length} or p.id::text ilike $${values.length} or p.public_id ilike $${values.length})`,
    );
  }
  if (bookingId) {
    values.push(bookingId);
    conditions.push(`p.booking_id = $${values.length}`);
  }
  if (normalizedType === "balance") {
    conditions.push(`coalesce(p.metadata_json->>'payment_type','deposit') = 'balance'`);
  }
  if (normalizedType === "deposit") {
    conditions.push(`coalesce(p.metadata_json->>'payment_type','deposit') <> 'balance'`);
  }

  const orderBySql =
    sortBy === "payment"
      ? `order by p.public_id ${directionSql}, p.id::text ${directionSql}`
      : sortBy === "booking"
        ? `order by b.public_id ${directionSql}, p.public_id ${directionSql}`
        : sortBy === "customer"
          ? `order by lower(c.full_name) ${directionSql}, lower(c.email) ${directionSql}, p.public_id ${directionSql}`
          : sortBy === "vehicle"
            ? `order by lower(v.make) ${directionSql}, lower(v.model) ${directionSql}, p.public_id ${directionSql}`
            : sortBy === "provider"
              ? `order by lower(p.provider) ${directionSql}, p.public_id ${directionSql}`
              : sortBy === "status"
                ? `order by upper(p.status) ${directionSql}, p.public_id ${directionSql}`
                : sortBy === "amount"
                  ? `order by p.deposit_amount_cents ${directionSql}, p.public_id ${directionSql}`
                  : `order by p.created_at ${directionSql}, p.public_id ${directionSql}`;

  const queryText =
    "select p.id, p.public_id, p.booking_id, b.public_id as booking_public_id, p.provider, p.status, p.deposit_amount_cents, p.created_at, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (conditions.length ? `where ${conditions.join(" and ")} ` : "") +
    orderBySql;

  const rows = await dbQuery<ExportRow>(queryText, values);

  const header = [
    "payment_public_id",
    "booking_public_id",
    "customer_name",
    "customer_email",
    "vehicle",
    "provider",
    "status",
    "amount",
    "created_at",
  ];

  const csvLines = [header.join(",")];
  for (const row of rows.rows) {
    const values = [
      row.public_id,
      row.booking_public_id ?? row.booking_id,
      row.customer_name,
      row.customer_email,
      `${row.vehicle_make} ${row.vehicle_model}`,
      row.provider,
      row.status,
      String(row.deposit_amount_cents),
      row.created_at,
    ].map((value) => csvEscape(String(value ?? "")));
    csvLines.push(values.join(","));
  }

  const csv = csvLines.join("\n");
  const filename = bookingId ? `payments-${bookingId}.csv` : "payments.csv";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";

function csvEscape(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

type ExportRow = {
  id: string;
  booking_id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get("bookingId")?.trim();
  const paymentType = searchParams.get("paymentType")?.trim();
  const normalizedType = paymentType === "balance" ? "balance" : paymentType === "deposit" ? "deposit" : "";

  const conditions: string[] = [];
  const values: string[] = [];
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

  const queryText =
    "select p.id, p.booking_id, p.provider, p.status, p.deposit_amount_cents, p.created_at, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (conditions.length ? `where ${conditions.join(" and ")} ` : "") +
    "order by p.created_at desc";

  const rows = await dbQuery<ExportRow>(queryText, values);

  const header = [
    "payment_id",
    "booking_id",
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
      row.id,
      row.booking_id,
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

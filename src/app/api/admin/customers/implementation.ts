import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { normalizeLegalIdType } from "@/lib/customers/legalId";
import { buildAdminExportPdf } from "@/lib/pdf/adminExportPdf";
import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";
import { normalizeCountryName, normalizeRegionForCountry } from "@/lib/jamaicaParishes";
import { formatJmdDecimal, formatJmdNumber } from "@/lib/money";

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

const CUSTOMER_SORT_COLUMNS = ["customer", "bookings", "totalSpend", "lastBooked", "created"] as const;
type CustomerSortBy = (typeof CUSTOMER_SORT_COLUMNS)[number];
type CustomerSortDir = SortDir;

export function normalizeCustomerSort(searchParams: URLSearchParams): {
  sortBy: CustomerSortBy;
  sortDir: CustomerSortDir;
} {
  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: CUSTOMER_SORT_COLUMNS,
    defaultSortBy: "lastBooked",
    defaultSortDir: "desc",
    legacySortParam: "sort",
    legacySortMap: {
      last_booked: { sortBy: "lastBooked", sortDir: "desc" },
      total_bookings: { sortBy: "bookings", sortDir: "desc" },
      total_spend: { sortBy: "totalSpend", sortDir: "desc" },
    },
  });

  return {
    sortBy: (sort.sortBy as CustomerSortBy | undefined) ?? "lastBooked",
    sortDir: (sort.sortDir as CustomerSortDir | undefined) ?? "desc",
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

export function createExcel(rows: CustomerListRow[]) {
  const nowLabel = formatGeneratedAt();
  const headers = [
    "Customer Name",
    "Email Address",
    "Phone Number",
    "Bookings",
    "Total Spend (JMD)",
    "Last Booked",
    "Created",
  ];

  const tableRows = [
    `<Row><Cell ss:StyleID="title"><Data ss:Type="String">Curated Car Rentals - Customers Report</Data></Cell></Row>`,
    `<Row><Cell ss:StyleID="meta"><Data ss:Type="String">Generated: ${xmlEscape(nowLabel)}</Data></Cell></Row>`,
    "<Row/>",
    `<Row>${headers
      .map(
        (header) =>
          `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`,
      )
      .join("")}</Row>`,
    ...rows.map((row) => {
      const totalSpend = formatJmdDecimal(Number(row.total_spend));
      const lastBooked = formatDateTime(row.last_booked_at);
      const created = formatDateTime(row.created_at);
      return `<Row>
        <Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(row.full_name)}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(row.email)}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(row.phone)}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="Number">${row.total_bookings}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="Number">${totalSpend}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(lastBooked)}</Data></Cell>
        <Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(created)}</Data></Cell>
      </Row>`;
    }),
  ].join("\n");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1a243b"/>
      <Interior ss:Color="#ffffff" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="title">
      <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#1f2d4d"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#5e6e8d"/>
    </Style>
    <Style ss:ID="header">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#ffffff"/>
      <Interior ss:Color="#1f2d4d" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="cell">
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#d4dced"/>
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="Customers">
    <Table>
      ${tableRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function formatDateTime(value: string | null) {
  if (!value) return "No bookings yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-JM", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatGeneratedAt() {
  return new Date().toLocaleString("en-JM", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSortLabel(sortBy: CustomerSortBy, sortDir: CustomerSortDir) {
  const label =
    sortBy === "customer"
      ? "Customer"
      : sortBy === "bookings"
        ? "Bookings"
        : sortBy === "totalSpend"
          ? "Total spend"
          : sortBy === "created"
            ? "Created"
            : "Last booked";
  return `${label} (${sortDir.toUpperCase()})`;
}

export function createPdf(rows: CustomerListRow[], options: { q: string; sortBy: CustomerSortBy; sortDir: CustomerSortDir }) {
  const totalBookings = rows.reduce((sum, row) => sum + Number(row.total_bookings || 0), 0);
  const totalSpend = rows.reduce((sum, row) => sum + Number(row.total_spend || 0), 0);
  const customersWithBookings = rows.filter((row) => Number(row.total_bookings || 0) > 0).length;

  return buildAdminExportPdf({
    title: "Customers Report",
    subtitle: "Customer relationships, booking history, and value at a glance.",
    metadata: [
      `Generated: ${formatGeneratedAt()}`,
      options.q ? `Search: ${options.q}` : "Search: All customers",
      `Sort: ${formatSortLabel(options.sortBy, options.sortDir)}`,
    ],
    summary: [
      { label: "Customers", value: String(rows.length) },
      { label: "With bookings", value: String(customersWithBookings) },
      { label: "Bookings", value: String(totalBookings) },
      {
        label: "Total spend",
        value: `J$${formatJmdNumber(totalSpend)}`,
      },
    ],
    columns: [
      { label: "Customer", width: 88 },
      { label: "Email", width: 130 },
      { label: "Phone", width: 62 },
      { label: "Bookings", width: 40, align: "right" },
      { label: "Spend", width: 60, align: "right" },
      { label: "Last Booked", width: 65 },
      { label: "Created", width: 70 },
    ],
    rows: rows.map((row) => [
      row.full_name || "Unnamed customer",
      row.email || "No email",
      row.phone || "No phone",
      String(row.total_bookings ?? 0),
      `J$${formatJmdNumber(row.total_spend)}`,
      formatDateTime(row.last_booked_at),
      formatDateTime(row.created_at),
    ]),
    emptyState: "No customers matched the selected filters.",
    footerNote: "Generated from the Curated Car Rentals admin customer export.",
  });
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.toLowerCase().includes(column.toLowerCase());
}

function isAnyMissingColumn(error: unknown, columns: string[]) {
  return columns.some((column) => isMissingColumn(error, column));
}

function isUniqueDriversLicenseError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const detail = String((error as { detail?: unknown } | null)?.detail ?? "").toLowerCase();
  return (
    code === "23505" &&
    (message.includes("customers_drivers_license_number_lower_unique") ||
      message.includes("drivers_license_number") ||
      detail.includes("drivers_license_number"))
  );
}

async function fetchCustomers({
  q,
  sortBy,
  sortDir,
}: {
  q: string;
  sortBy: CustomerSortBy;
  sortDir: CustomerSortDir;
}) {
  const whereSql = q
    ? "where c.full_name ilike $1 or c.email ilike $1 or c.phone ilike $1"
    : "";
  const values = q ? [`${q}%`] : [];

  const direction = sortDir === "asc" ? "asc" : "desc";
  const orderBy =
    sortBy === "customer"
      ? `order by lower(c.full_name) ${direction}, lower(c.email) ${direction}, c.id::text ${direction}`
      : sortBy === "bookings"
        ? `order by total_bookings ${direction}, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc`
        : sortBy === "totalSpend"
          ? `order by total_spend ${direction}, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc`
          : sortBy === "created"
            ? `order by c.created_at ${direction}, c.id::text ${direction}`
            : `order by coalesce(c.last_booked_at, max(b.created_at), c.created_at) ${direction}, c.id::text ${direction}`;

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
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const sort = normalizeCustomerSort(url.searchParams);
  const exportMode = (url.searchParams.get("export") ?? "").toLowerCase();

  const result = await fetchCustomers({ q, sortBy: sort.sortBy, sortDir: sort.sortDir });
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
  if (exportMode === "excel" || exportMode === "xls") {
    const excel = createExcel(result.rows);
    return new NextResponse(excel, {
      status: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": 'attachment; filename="customers.xls"',
      },
    });
  }
  if (exportMode === "pdf") {
    const pdf = createPdf(result.rows, { q, sortBy: sort.sortBy, sortDir: sort.sortDir });
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="customers.pdf"',
      },
    });
  }

  return NextResponse.json({ customers: result.rows });
}

export async function POST(request: Request) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as
      | {
        firstName?: unknown;
        lastName?: unknown;
        fullName?: unknown;
        email?: unknown;
        phone?: unknown;
        street?: unknown;
        street2?: unknown;
        city?: unknown;
        parish?: unknown;
        state?: unknown;
        country?: unknown;
        birthday?: unknown;
        driversLicenseNumber?: unknown;
        driversLicenseExpirationDate?: unknown;
        legalIdType?: unknown;
        legalIdNumber?: unknown;
        legalIdExpirationDate?: unknown;
        address?: unknown;
        notes?: unknown;
        csrfToken?: string | null;
      }
    | null;

  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  let firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  let lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  const fullNameInput = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const street = typeof body?.street === "string" ? body.street.trim() : "";
  const street2 = typeof body?.street2 === "string" ? body.street2.trim() : "";
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const regionInput =
    typeof body?.parish === "string"
      ? body.parish.trim()
      : typeof body?.state === "string"
        ? body.state.trim()
        : "";
  const country = normalizeCountryName(body?.country) ?? "Jamaica";
  const state = normalizeRegionForCountry(regionInput, country);
  const birthdayInput = typeof body?.birthday === "string" ? body.birthday.trim() : "";
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(birthdayInput) ? birthdayInput : null;
  const driversLicenseNumber =
    typeof body?.driversLicenseNumber === "string" ? body.driversLicenseNumber.trim() : "";
  const driversLicenseExpirationDateInput =
    typeof body?.driversLicenseExpirationDate === "string"
      ? body.driversLicenseExpirationDate.trim()
      : "";
  const driversLicenseExpirationDate = /^\d{4}-\d{2}-\d{2}$/.test(driversLicenseExpirationDateInput)
    ? driversLicenseExpirationDateInput
    : null;
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber =
    typeof body?.legalIdNumber === "string" ? body.legalIdNumber.trim() : "";
  const legalIdExpirationDateInput =
    typeof body?.legalIdExpirationDate === "string" ? body.legalIdExpirationDate.trim() : "";
  const legalIdExpirationDate = /^\d{4}-\d{2}-\d{2}$/.test(legalIdExpirationDateInput)
    ? legalIdExpirationDateInput
    : null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if ((!firstName || !lastName) && fullNameInput) {
    const parts = fullNameInput.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = firstName || parts[0];
      lastName = lastName || parts[parts.length - 1];
    }
  }

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "First name and last name are required." }, { status: 400 });
  }
  if (email && !isEmail(email)) {
    return NextResponse.json({ error: "Email is invalid." }, { status: 400 });
  }
  if (driversLicenseExpirationDateInput && !driversLicenseExpirationDate) {
    return NextResponse.json({ error: "Driver's license expiration date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (legalIdExpirationDateInput && !legalIdExpirationDate) {
    return NextResponse.json({ error: "Legal ID expiration date must be YYYY-MM-DD." }, { status: 400 });
  }

  const fullName = `${firstName} ${lastName}`.trim();

  try {
    let insert;
    try {
      insert = await dbQuery<{ id: string; full_name: string; email: string; phone: string }>(
        "insert into customers (full_name, email, phone, first_name, last_name, street, street2, city, state, zip, country, birthday, drivers_license_number, drivers_license_expiration_date, legal_id_type, legal_id_number, legal_id_expiration_date, address, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14::date, $15, $16, $17::date, $18, $19) returning id, full_name, email, phone",
        [
          fullName,
          email,
          phone,
          firstName,
          lastName,
          street || null,
          street2 || null,
          city || null,
          state || null,
          null,
          country || null,
          birthday,
          driversLicenseNumber || null,
          driversLicenseExpirationDate,
          legalIdType || null,
          legalIdNumber || null,
          legalIdExpirationDate,
          address || null,
          notes || null,
        ],
      );
    } catch (error) {
      if (isUniqueDriversLicenseError(error)) {
        return NextResponse.json(
          { error: "Driver's license number is already assigned to another customer." },
          { status: 409 },
        );
      }
      if (
        !isAnyMissingColumn(error, [
          "first_name",
          "last_name",
          "street",
          "street2",
          "city",
          "state",
          "zip",
          "country",
          "birthday",
          "drivers_license_number",
          "drivers_license_expiration_date",
          "legal_id_type",
          "legal_id_number",
          "legal_id_expiration_date",
        ])
      ) {
        throw error;
      }
      try {
        insert = await dbQuery<{ id: string; full_name: string; email: string; phone: string }>(
          "insert into customers (full_name, email, phone, first_name, last_name, address, notes) values ($1, $2, $3, $4, $5, $6, $7) returning id, full_name, email, phone",
          [fullName, email, phone, firstName, lastName, address || null, notes || null],
        );
      } catch (fallbackError) {
        if (isUniqueDriversLicenseError(fallbackError)) {
          return NextResponse.json(
            { error: "Driver's license number is already assigned to another customer." },
            { status: 409 },
          );
        }
        if (!isAnyMissingColumn(fallbackError, ["first_name", "last_name"])) {
          throw fallbackError;
        }
        insert = await dbQuery<{ id: string; full_name: string; email: string; phone: string }>(
          "insert into customers (full_name, email, phone, address, notes) values ($1, $2, $3, $4, $5) returning id, full_name, email, phone",
          [fullName, email, phone, address || null, notes || null],
        );
      }
    }

    const created = insert.rows[0];
    await writeAuditLog({
      userId: session.userId,
      action: "CUSTOMER_CREATED",
      entityType: "customer",
      entityId: created.id,
      details: { fullName: created.full_name, email: created.email, phone: created.phone },
    });

    return NextResponse.json({ customer: created }, { status: 201 });
  } catch (error) {
    logError("api.admin.customers.POST", error, {
      userId: session.userId,
      role: session.role,
      email,
      phone,
    });
    return NextResponse.json({ error: "Unable to create customer." }, { status: 500 });
  }
}

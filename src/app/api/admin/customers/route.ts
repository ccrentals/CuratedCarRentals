import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { normalizeLegalIdType } from "@/lib/customers/legalId";
import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";

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

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

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

function createExcel(rows: CustomerListRow[]) {
  const nowLabel = new Date().toLocaleString();
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
      const totalSpend = (Number(row.total_spend) / 100).toFixed(2);
      const lastBooked = row.last_booked_at ? new Date(row.last_booked_at).toLocaleString() : "No bookings yet";
      const created = new Date(row.created_at).toLocaleString();
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

function pdfEscape(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}

function createPdfContentStream(lines: string[]) {
  const commands = ["BT", "/F1 8 Tf", "11 TL", "36 760 Td"];
  lines.forEach((line, index) => {
    commands.push(`(${pdfEscape(line)}) Tj`);
    if (index < lines.length - 1) {
      commands.push("T*");
    }
  });
  commands.push("ET");
  const stream = commands.join("\n");
  return `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
}

function createPdf(rows: CustomerListRow[]) {
  const headerLine =
    "Customer Name".padEnd(24) +
    "Email".padEnd(29) +
    "Phone".padEnd(14) +
    "Bookings".padStart(9) +
    "Spend".padStart(14) +
    "Last Booked".padStart(20);
  const divider = "-".repeat(110);
  const generatedAt = new Date().toLocaleString();

  const dataLines = rows.map((row) => {
    const name = row.full_name.slice(0, 23).padEnd(24);
    const email = row.email.slice(0, 28).padEnd(29);
    const phone = row.phone.slice(0, 13).padEnd(14);
    const bookings = String(row.total_bookings).padStart(9);
    const spend = `J$${(Number(row.total_spend) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`.padStart(14);
    const lastBooked = (row.last_booked_at ? new Date(row.last_booked_at).toLocaleDateString() : "No bookings")
      .slice(0, 20)
      .padStart(20);
    return `${name}${email}${phone}${bookings}${spend}${lastBooked}`;
  });

  const maxLinesPerPage = 52;
  const bodyLines = [headerLine, divider, ...dataLines];
  const pageChunks: string[][] = [];
  for (let index = 0; index < bodyLines.length; index += maxLinesPerPage) {
    pageChunks.push(bodyLines.slice(index, index + maxLinesPerPage));
  }
  if (pageChunks.length === 0) pageChunks.push([]);

  const objectBodies: string[] = [];
  objectBodies.push("<< /Type /Catalog /Pages 2 0 R >>");
  objectBodies.push("<< /Type /Pages /Kids [] /Count 0 >>");
  objectBodies.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  const pageObjectNumbers: number[] = [];
  for (let pageIndex = 0; pageIndex < pageChunks.length; pageIndex += 1) {
    const titleLines = [
      "Curated Car Rentals - Customers Report",
      `Generated: ${generatedAt}`,
      `Page ${pageIndex + 1} of ${pageChunks.length}`,
      "",
      ...pageChunks[pageIndex],
    ];
    const contentObjectNumber = objectBodies.push(createPdfContentStream(titleLines));
    const pageObjectNumber = objectBodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    );
    pageObjectNumbers.push(pageObjectNumber);
  }

  objectBodies[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objectBodies.length; index += 1) {
    const objectNumber = index + 1;
    offsets[objectNumber] = Buffer.byteLength(pdf, "utf8");
    pdf += `${objectNumber} 0 obj\n${objectBodies[index]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objectBodies.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objectBodies.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    const pdf = createPdf(result.rows);
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
        state?: unknown;
        zip?: unknown;
        country?: unknown;
        birthday?: unknown;
        driversLicenseNumber?: unknown;
        legalIdType?: unknown;
        legalIdNumber?: unknown;
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
  const state = typeof body?.state === "string" ? body.state.trim() : "";
  const zip = typeof body?.zip === "string" ? body.zip.trim() : "";
  const country = typeof body?.country === "string" ? body.country.trim() : "";
  const birthdayInput = typeof body?.birthday === "string" ? body.birthday.trim() : "";
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(birthdayInput) ? birthdayInput : null;
  const driversLicenseNumber =
    typeof body?.driversLicenseNumber === "string" ? body.driversLicenseNumber.trim() : "";
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber =
    typeof body?.legalIdNumber === "string" ? body.legalIdNumber.trim() : "";
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

  const fullName = `${firstName} ${lastName}`.trim();

  try {
    let insert;
    try {
      insert = await dbQuery<{ id: string; full_name: string; email: string; phone: string }>(
        "insert into customers (full_name, email, phone, first_name, last_name, street, street2, city, state, zip, country, birthday, drivers_license_number, legal_id_type, legal_id_number, address, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14, $15, $16, $17) returning id, full_name, email, phone",
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
          zip || null,
          country || null,
          birthday,
          driversLicenseNumber || null,
          legalIdType || null,
          legalIdNumber || null,
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
          "legal_id_type",
          "legal_id_number",
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

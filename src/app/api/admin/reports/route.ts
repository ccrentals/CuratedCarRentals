import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  buildReportsFilterQueryString,
  getAdminReportsPayload,
  normalizeReportsFilters,
  type AdminReportsPayload,
  type ReportsFilterInput,
} from "@/lib/reports/adminReports";

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

export type ReportsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getPayload: (
    filters: ReportsFilterInput,
  ) => Promise<AdminReportsPayload>;
};

const DEFAULT_DEPS: ReportsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getPayload: (filters) => getAdminReportsPayload(filters),
};

function parseFilters(searchParams: URLSearchParams): ReportsFilterInput {
  return {
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    vehicleId: searchParams.get("vehicleId"),
    revenueGranularity: searchParams.get("revenueGranularity"),
  };
}

type ExportFormat = "csv" | "excel" | "pdf";
type ExportReportKey =
  | "outstanding_balances"
  | "pickups"
  | "returns"
  | "upcoming_combined"
  | "cancellations_refunds";

type ExportTable = {
  title: string;
  headers: string[];
  rows: Array<Array<unknown>>;
};

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "csv" || value === "excel" || value === "pdf";
}

function isExportReportKey(value: unknown): value is ExportReportKey {
  return (
    value === "outstanding_balances" ||
    value === "pickups" ||
    value === "returns" ||
    value === "upcoming_combined" ||
    value === "cancellations_refunds"
  );
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeTextCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function exportTitleForKey(key: ExportReportKey) {
  if (key === "outstanding_balances") return "Outstanding Balances";
  if (key === "pickups") return "Upcoming Pickups";
  if (key === "returns") return "Upcoming Returns";
  if (key === "upcoming_combined") return "Upcoming Pickups and Returns";
  return "Cancellations and Refunds";
}

function buildTablesForReport(key: ExportReportKey, payload: AdminReportsPayload): ExportTable[] {
  if (key === "outstanding_balances") {
    return [
      {
        title: "Outstanding Balances",
        headers: [
          "Booking ID",
          "Customer",
          "Vehicle",
          "Pickup Date",
          "Return Date",
          "Status",
          "Payment Option",
          "Payment Status",
          "Total",
          "Amount Paid",
          "Balance Due",
          "Days From Pickup",
        ],
        rows: payload.outstandingBalances.rows.map((row) => [
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.total,
          row.amountPaid,
          row.balanceDue,
          row.daysFromPickup,
        ]),
      },
    ];
  }

  if (key === "pickups") {
    return [
      {
        title: "Pickups",
        headers: [
          "Booking ID",
          "Customer",
          "Vehicle",
          "Pickup Date",
          "Return Date",
          "Status",
          "Payment Option",
          "Payment Status",
          "Non-Blocking",
          "Total",
          "Amount Paid",
          "Balance Due",
        ],
        rows: payload.upcoming.pickups.map((row) => [
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
      },
    ];
  }

  if (key === "returns") {
    return [
      {
        title: "Returns",
        headers: [
          "Booking ID",
          "Customer",
          "Vehicle",
          "Pickup Date",
          "Return Date",
          "Status",
          "Payment Option",
          "Payment Status",
          "Non-Blocking",
          "Total",
          "Amount Paid",
          "Balance Due",
        ],
        rows: payload.upcoming.returns.map((row) => [
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
      },
    ];
  }

  if (key === "upcoming_combined") {
    return [
      {
        title: "Pickups",
        headers: [
          "Booking ID",
          "Customer",
          "Vehicle",
          "Pickup Date",
          "Return Date",
          "Status",
          "Payment Option",
          "Payment Status",
          "Non-Blocking",
          "Total",
          "Amount Paid",
          "Balance Due",
        ],
        rows: payload.upcoming.pickups.map((row) => [
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
      },
      {
        title: "Returns",
        headers: [
          "Booking ID",
          "Customer",
          "Vehicle",
          "Pickup Date",
          "Return Date",
          "Status",
          "Payment Option",
          "Payment Status",
          "Non-Blocking",
          "Total",
          "Amount Paid",
          "Balance Due",
        ],
        rows: payload.upcoming.returns.map((row) => [
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
      },
    ];
  }

  return [
    {
      title: "Cancellations and Refunds",
      headers: [
        "Row Type",
        "Booking ID",
        "Customer",
        "Vehicle",
        "Status",
        "Overridden",
        "Event At",
        "Reason",
        "Payment ID",
        "Amount",
      ],
      rows: [
        ...payload.cancellationRefundImpact.cancellations.map((row) => [
          "Cancellation",
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.status,
          row.isOverridden ? "Yes" : "No",
          row.cancelledAt,
          row.cancellationReason,
          "",
          "",
        ]),
        ...payload.cancellationRefundImpact.refunds.map((row) => [
          "Refund",
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          "",
          "",
          row.refundedAt,
          "",
          row.paymentId,
          row.amount,
        ]),
      ],
    },
  ];
}

function buildReportMetaLines(payload: AdminReportsPayload) {
  const lines = [
    `Generated At: ${payload.generatedAt}`,
    `Date Range: ${payload.filters.dateFrom} to ${payload.filters.dateTo}`,
  ];
  if (payload.filters.vehicleId) {
    lines.push(`Vehicle Filter: ${payload.filters.vehicleId}`);
  }
  return lines;
}

function exportTablesAsCsv(title: string, meta: string[], tables: ExportTable[]) {
  const lines: string[] = [`# ${title}`, ...meta.map((line) => `# ${line}`), ""];
  for (const table of tables) {
    lines.push(`# ${table.title}`);
    lines.push(table.headers.map(csvEscape).join(","));
    for (const row of table.rows) {
      lines.push(row.map(csvEscape).join(","));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function exportTablesAsExcel(title: string, meta: string[], tables: ExportTable[]) {
  const rows: string[] = [];
  rows.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  rows.push(
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
  );
  rows.push(`<Worksheet ss:Name="Report"><Table>`);
  rows.push(
    `<Row><Cell><Data ss:Type="String">${xmlEscape(title)}</Data></Cell></Row>`,
  );
  for (const line of meta) {
    rows.push(`<Row><Cell><Data ss:Type="String">${xmlEscape(line)}</Data></Cell></Row>`);
  }
  rows.push(`<Row><Cell><Data ss:Type="String"></Data></Cell></Row>`);

  for (const table of tables) {
    rows.push(`<Row><Cell><Data ss:Type="String">${xmlEscape(table.title)}</Data></Cell></Row>`);
    rows.push(
      `<Row>${table.headers
        .map((header) => `<Cell><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`)
        .join("")}</Row>`,
    );
    for (const row of table.rows) {
      rows.push(
        `<Row>${row
          .map(
            (cell) =>
              `<Cell><Data ss:Type="String">${xmlEscape(normalizeTextCell(cell))}</Data></Cell>`,
          )
          .join("")}</Row>`,
      );
    }
    rows.push(`<Row><Cell><Data ss:Type="String"></Data></Cell></Row>`);
  }

  rows.push(`</Table></Worksheet></Workbook>`);
  return rows.join("");
}

function sanitizePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapPdfLine(line: string, maxChars = 96) {
  const clean = line.trimEnd();
  if (clean.length <= maxChars) return [clean];
  const wrapped: string[] = [];
  let cursor = clean;
  while (cursor.length > maxChars) {
    const splitAt = cursor.lastIndexOf(" ", maxChars);
    const index = splitAt > 0 ? splitAt : maxChars;
    wrapped.push(cursor.slice(0, index));
    cursor = cursor.slice(index).trimStart();
  }
  if (cursor.length > 0) wrapped.push(cursor);
  return wrapped;
}

function buildPdfFromLines(lines: string[]) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 40;
  const top = 800;
  const lineHeight = 14;
  const linesPerPage = 52;
  const pages: string[][] = [];

  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push(["Report"]);
  }

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const pageRefs: string[] = [];
  let nextObjectId = 4;

  for (const pageLines of pages) {
    const pageId = nextObjectId++;
    const contentId = nextObjectId++;
    pageRefs.push(`${pageId} 0 R`);

    const contentCommands: string[] = [
      "BT",
      "/F1 10 Tf",
      `${marginLeft} ${top} Td`,
      `${lineHeight} TL`,
    ];
    pageLines.forEach((line, index) => {
      contentCommands.push(`(${sanitizePdfText(line)}) Tj`);
      if (index < pageLines.length - 1) {
        contentCommands.push("T*");
      }
    });
    contentCommands.push("ET");
    const stream = contentCommands.join("\n");
    const length = Buffer.byteLength(stream, "ascii");
    objects[contentId] = `<< /Length ${length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  const maxObjectId = objects.length - 1;

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function exportTablesAsPdf(title: string, meta: string[], tables: ExportTable[]) {
  const lines: string[] = [title, ...meta, ""];
  for (const table of tables) {
    lines.push(table.title);
    lines.push(table.headers.join(" | "));
    lines.push("-".repeat(96));
    for (const row of table.rows) {
      const rowText = row.map((cell) => normalizeTextCell(cell)).join(" | ");
      lines.push(...wrapPdfLine(rowText, 96));
    }
    lines.push("");
  }
  return buildPdfFromLines(lines);
}

export async function handleReportsGet(request: Request, deps: ReportsRouteDeps = DEFAULT_DEPS) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const format = String(searchParams.get("format") ?? "").trim().toLowerCase();
  const report = String(searchParams.get("report") ?? "").trim().toLowerCase();

  const payload = await deps.getPayload(filters);

  if (format.length > 0) {
    if (!isExportFormat(format)) {
      return NextResponse.json(
        { ok: false, error: "Invalid format. Use csv, excel, or pdf." },
        { status: 400 },
      );
    }
    if (!isExportReportKey(report)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid report key. Use one of: outstanding_balances, pickups, returns, upcoming_combined, cancellations_refunds.",
        },
        { status: 400 },
      );
    }
    const exportTitle = exportTitleForKey(report);
    const exportMeta = buildReportMetaLines(payload);
    const tables = buildTablesForReport(report, payload);
    const filenameBase = `${report}-${payload.filters.dateFrom}-to-${payload.filters.dateTo}`;

    if (format === "csv") {
      const csv = exportTablesAsCsv(exportTitle, exportMeta, tables);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=${filenameBase}.csv`,
        },
      });
    }

    if (format === "excel") {
      const excel = exportTablesAsExcel(exportTitle, exportMeta, tables);
      return new Response(excel, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename=${filenameBase}.xls`,
        },
      });
    }

    const pdf = exportTablesAsPdf(exportTitle, exportMeta, tables);
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${filenameBase}.pdf`,
      },
    });
  }

  const normalizedFilters = normalizeReportsFilters(filters);
  return NextResponse.json({
    ok: true,
    filters: normalizedFilters,
    filterQuery: buildReportsFilterQueryString(normalizedFilters),
    report: payload,
  });
}

export async function GET(request: Request) {
  return handleReportsGet(request);
}

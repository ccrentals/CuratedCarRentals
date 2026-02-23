import { NextResponse } from "next/server";

import { handleAdminMaintenanceGet } from "@/app/api/admin/maintenance/route";

type MaintenanceExportItem = {
  vehicleLabel: string;
  title: string;
  category: string;
  status: string;
  dueState: string;
  scheduledDate: string | null;
  serviceDate: string | null;
  nextDueDate: string | null;
  totalCostCents: number;
};

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCurrency(cents: number) {
  return (Math.round(cents) / 100).toFixed(2);
}

export async function GET(request: Request) {
  const response = await handleAdminMaintenanceGet(request);
  if (!response.ok) return response;

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; items?: MaintenanceExportItem[] }
    | null;

  if (!payload?.ok) {
    return NextResponse.json({ ok: false, error: "Failed to export maintenance records." }, { status: 500 });
  }

  const rows = Array.isArray(payload.items) ? payload.items : [];
  const header = [
    "Vehicle",
    "Maintenance Item",
    "Category",
    "Status",
    "Due State",
    "Scheduled Date",
    "Service Date",
    "Next Due Date",
    "Total Cost (JMD)",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.vehicleLabel ?? ""),
        csvEscape(row.title ?? ""),
        csvEscape(row.category ?? ""),
        csvEscape(row.status ?? ""),
        csvEscape(row.dueState ?? ""),
        csvEscape(row.scheduledDate ?? ""),
        csvEscape(row.serviceDate ?? ""),
        csvEscape(row.nextDueDate ?? ""),
        formatCurrency(row.totalCostCents ?? 0),
      ].join(","),
    );
  }

  const csv = `${lines.join("\n")}\n`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="maintenance-export.csv"',
    },
  });
}

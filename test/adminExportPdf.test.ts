import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminExportPdf } from "@/lib/pdf/adminExportPdf";

test("admin export PDF builder creates branded PDF content", () => {
  const pdf = buildAdminExportPdf({
    title: "Customers Report",
    subtitle: "Customer relationships and booking value.",
    metadata: ["Generated: Mar 19, 2026, 10:30 AM", "Search: Damian"],
    summary: [
      { label: "Customers", value: "12" },
      { label: "Bookings", value: "28" },
    ],
    columns: [
      { label: "Customer", width: 200 },
      { label: "Email", width: 200 },
      { label: "Spend", width: 115, align: "right" },
    ],
    rows: [["Damian Thompson", "damian@example.com", "J$12,500.00"]],
    footerNote: "Generated from the Curated Car Rentals admin customer export.",
  });

  const text = Buffer.from(pdf).toString("latin1");
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /Customers Report/);
  assert.match(text, /Curated Car Rentals/);
  assert.match(text, /CCR/);
  assert.match(text, /Damian Thompson/);
});

import Link from "next/link";

import { DocumentationEditor } from "@/components/admin/DocumentationEditor";
import { dbQuery } from "@/lib/db";

type DocRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

export default async function AdminDocumentationPage() {
  let doc: DocRow | null = null;
  let tableMissing = false;

  try {
    const docResult = await dbQuery<DocRow>(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = 'documentation'",
    );
    doc = docResult.rows[0] ?? null;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      tableMissing = true;
    } else {
      throw error;
    }
  }

  const updatedAt = doc?.updated_at ? new Date(doc.updated_at).toLocaleDateString() : "Not yet set";
  const updatedBy = "System";
  const notesContent = doc?.content ?? "";

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Documentation</h1>
        </div>
        <Link
          href="/admin"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="mt-6 space-y-6 text-sm text-[var(--ccr-text)]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Update Summary</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Last updated: <span className="font-semibold text-[var(--ccr-text)]">{updatedAt}</span>
          </p>
          <p className="mt-1 text-[var(--ccr-muted)]">
            Last updated by: <span className="font-semibold text-[var(--ccr-text)]">{updatedBy}</span>
          </p>
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Changelog
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[var(--ccr-muted)]">
              <li>Added admin calendar, reports, and documentation overview.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Overview</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Curated Car Rentals provides a public booking flow with online deposit payments and an
            internal admin portal for fleet, bookings, and operational tracking.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Customer Booking Flow</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--ccr-muted)]">
            <li>Customers browse fleet and create a booking request.</li>
            <li>Deposits are paid online (WiPay hosted checkout).</li>
            <li>Balance is collected on pickup and recorded by admin.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Admin Tools</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--ccr-muted)]">
            <li>Dashboard with booking totals and quick links.</li>
            <li>Bookings list with filters and detailed booking management.</li>
            <li>Vehicles list plus per-vehicle edit and blockout management.</li>
            <li>Payments list with booking links.</li>
            <li>Calendar view for bookings + blockouts.</li>
            <li>Reports dashboard for revenue, utilization, and outstanding balances.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Blockouts & Maintenance</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Blockouts allow admins to mark vehicles as unavailable for maintenance or private use.
            Blockouts cannot overlap active bookings and will be blocked if they do.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Notes & Audit Trail</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Admin notes are stored on bookings and should be used for internal updates. Key admin
            actions are recorded in the audit log for accountability.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Known Limitations</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--ccr-muted)]">
            <li>Refund workflow is not automated yet (manual handling required).</li>
            <li>Blockouts require the blockouts table to be installed in the database.</li>
            <li>Admin password hashing is still basic and should be upgraded before production.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Update Notes</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Keep this page updated as new features ship. Add release notes, operational policies,
            and any changes to payment or booking workflows.
          </p>
          <div className="mt-4 whitespace-pre-wrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 text-sm text-[var(--ccr-text)]">
            {notesContent || "No notes yet."}
          </div>
          {tableMissing ? (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <p className="font-semibold">System-managed documentation</p>
              <p className="mt-1">
                Documentation updates are managed by the system. Editable notes are currently
                unavailable.
              </p>
            </div>
          ) : (
            <DocumentationEditor initialContent={notesContent} disabled={false} />
          )}
        </section>
      </div>
    </div>
  );
}

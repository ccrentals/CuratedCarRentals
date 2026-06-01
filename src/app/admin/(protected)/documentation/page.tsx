import Link from "next/link";
import { notFound } from "next/navigation";

import { DocumentationEditor } from "@/components/admin/DocumentationEditor";
import { DocumentationSectionSearch } from "@/components/admin/DocumentationSectionSearch";
import { resolveAdminActor } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import {
  buildDocumentationSearchEntries,
  DOCUMENTATION_SECTION_LINKS,
} from "@/lib/documentation/catalog";
import { fmtDateOnly } from "@/lib/dateFormat";

type DocRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

export default async function AdminDocumentationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await resolveAdminActor({ requirement: "developer" });
  if (!access.ok) {
    notFound();
  }
  const params = await searchParams;

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

  const updatedAt = doc?.updated_at ? fmtDateOnly(doc.updated_at) : "Not yet set";
  const updatedBy = doc?.updated_by_email ?? "System";
  const notesContent = doc?.content ?? "";
  const initialQuery =
    typeof params.q === "string" ? params.q.trim() : Array.isArray(params.q) ? String(params.q[0] ?? "").trim() : "";
  const searchEntries = buildDocumentationSearchEntries(notesContent);

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
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Documentation</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            This area is the source of truth for product, design, technical, and operational notes. Use the
            section pages below for detailed documentation, use search to jump across sections, topics, and
            notes, and use the notes panel at the bottom for quick release reminders.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Sections</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Child links are grouped by main headings (not per-topic). Search can also surface individual
            documentation topics and matching notes content.
          </p>
          <DocumentationSectionSearch
            initialQuery={initialQuery}
            sections={DOCUMENTATION_SECTION_LINKS}
            searchEntries={searchEntries}
          />
        </section>

        <section
          id="notes-change-log"
          className="scroll-mt-24 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6"
        >
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Notes & Change Log</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Last updated: <span className="font-semibold text-[var(--ccr-text)]">{updatedAt}</span> ·
            Last updated by: <span className="font-semibold text-[var(--ccr-text)]">{updatedBy}</span>
          </p>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Use this notes area for high-level release notes, operational reminders, and any changes that
            should be shared quickly across the team.
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

import Link from "next/link";
import { isDeveloperRole } from "@/lib/auth/roles";

import { DeveloperChecklistEditor } from "@/components/admin/DeveloperChecklistEditor";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { normalizeDeveloperChecklistDocument } from "@/lib/developerChecklist";
import { DOCUMENTATION_SECTION_CHILDREN } from "@/lib/documentation/catalog";

const DOC_KEY = "developer_checklist";

const DOCUMENTATION_LINKS = [
  { href: "/admin/documentation", label: "Documentation Home" },
  ...DOCUMENTATION_SECTION_CHILDREN,
  { href: "/admin/developer/access", label: "Role Capability Matrix" },
];

export default async function AdminDeveloperPage() {
  const session = await getSessionFromRequest();
  const canAdmin = isDeveloperRole(session?.role);

  let initialContent = normalizeDeveloperChecklistDocument({});
  let updatedAt: string | null = null;
  let updatedByEmail: string | null = null;
  let tableMissing = false;

  if (canAdmin) {
    try {
      const result = await dbQuery<{
        content: string;
        updated_at: string;
        updated_by_email: string | null;
      }>(
        "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
        [DOC_KEY],
      );

      const row = result.rows[0] ?? null;
      const parsed = typeof row?.content === "string" && row.content.trim()
        ? JSON.parse(row.content)
        : {};
      initialContent = normalizeDeveloperChecklistDocument(parsed);
      updatedAt = row?.updated_at ?? null;
      updatedByEmail = row?.updated_by_email ?? null;
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
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Developer</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Track go-live verification, pass/fail status, and release notes from a single page.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to dashboard
        </Link>
      </div>

      {!canAdmin ? (
        <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Restricted</h2>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Only DEVELOPER users can view and edit developer checklists.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Documentation quick links</h2>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              Keep implementation notes connected to the source documentation pages.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DOCUMENTATION_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </section>

          {tableMissing ? (
            <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
              <h2 className="text-lg font-bold text-[var(--ccr-text)]">Checklist storage not configured</h2>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                The <code>admin_documents</code> table is missing. Apply the current schema in Neon and refresh this
                page.
              </p>
            </section>
          ) : (
            <div className="mt-6">
              <DeveloperChecklistEditor
                initialEntries={initialContent.items}
                initialGeneralNotes={initialContent.generalNotes}
                updatedAt={updatedAt}
                updatedByEmail={updatedByEmail}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

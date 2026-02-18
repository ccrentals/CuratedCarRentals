import Link from "next/link";

import { DocumentationEditor } from "@/components/admin/DocumentationEditor";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";

type DocRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

const DOCUMENTATION_SECTIONS = [
  {
    href: "/admin/documentation/prd",
    label: "PRD / Specification",
    description: "Project goals, scope, requirements, sitemap, and user stories.",
    topics: ["Purpose & goals", "Personas", "Functional + non-functional requirements", "Sitemap", "User stories"],
  },
  {
    href: "/admin/documentation/design",
    label: "Design Documentation",
    description: "Brand tokens, UI patterns, accessibility standards, and layout guidance.",
    topics: ["Brand guidelines", "Wireframes & mockups", "UI style guide", "WCAG accessibility"],
  },
  {
    href: "/admin/documentation/technical",
    label: "Technical Documentation",
    description: "System architecture, APIs, database schema, and deployment environment.",
    topics: ["Technology stack", "API endpoints", "Database schema", "Hosting & deployment", "Repo structure"],
  },
  {
    href: "/admin/documentation/operations",
    label: "Operational & User Documentation",
    description: "Runbooks for content, roles, maintenance, and troubleshooting.",
    topics: ["Content updates", "User roles", "Maintenance plan", "Troubleshooting"],
  },
  {
    href: "/admin/documentation/legal",
    label: "Legal & Compliance",
    description: "Policy templates and third-party processor disclosures.",
    topics: ["Privacy policy", "Terms & conditions", "Cookie policy", "PCI considerations"],
  },
  {
    href: "/admin/documentation/project-management",
    label: "Project Management",
    description: "Milestones, change log process, and resourcing templates.",
    topics: ["Timeline", "Milestones", "Budget & resources", "Change log"],
  },
] as const;

function isDeveloperRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "DEVELOPER";
}

export default async function AdminDocumentationPage() {
  const session = await getSessionFromRequest();
  const canDeveloper = isDeveloperRole(session?.role);

  if (!canDeveloper) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">Documentation</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Only DEVELOPER users can view administration documentation.
          </p>
        </section>
      </div>
    );
  }

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
  const updatedBy = doc?.updated_by_email ?? "System";
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
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Documentation</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            This area is the source of truth for product, design, technical, and operational notes. Use the
            section pages below for detailed documentation, and use the notes panel at the bottom for quick
            release notes / reminders.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Sections</h2>
          <p className="mt-2 text-[var(--ccr-muted)]">
            Child links are grouped by main headings (not per-topic). Each section page includes multiple
            topics.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {DOCUMENTATION_SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="group rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 transition hover:bg-[var(--ccr-surface-soft)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-[var(--ccr-text)]">{section.label}</h3>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">{section.description}</p>
                  </div>
                  <span className="mt-0.5 rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)] group-hover:text-[var(--ccr-text)]">
                    Open
                  </span>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--ccr-muted)]">
                  {section.topics.map((topic) => (
                    <li key={topic}>{topic}</li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
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

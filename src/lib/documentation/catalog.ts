export type DocumentationBlockMeta = {
  id: string;
  title: string;
  summary: string;
  searchText: string;
};

export type DocumentationSectionMeta = {
  slug: string;
  label: string;
  description: string;
  topics: readonly string[];
  blocks: readonly DocumentationBlockMeta[];
};

export type DocumentationSectionLink = {
  href: string;
  label: string;
  description: string;
  topics: readonly string[];
};

export type DocumentationSearchEntry = {
  id: string;
  type: "section" | "topic" | "notes";
  href: string;
  sectionLabel: string;
  title: string;
  snippet: string;
  snippetSource: string;
  searchText: string;
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function toDocumentationAnchorId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const DOCUMENTATION_CATALOG = [
  {
    slug: "prd",
    label: "PRD / Specification",
    description:
      "Defines the scope, goals, users, and requirements for the Curated Car Rentals website and admin portal.",
    topics: [
      "Purpose & goals",
      "Personas",
      "Functional + non-functional requirements",
      "Sitemap",
      "User stories",
    ],
    blocks: [
      {
        id: "purpose-goals",
        title: "Purpose & Goals (SMART)",
        summary: "Business goals, success targets, and operational readiness metrics for the product.",
        searchText: "smart goals success metrics booking requests admin time deposit collection go live readiness",
      },
      {
        id: "target-audience",
        title: "Target Audience (Personas)",
        summary: "Primary customer and operations personas served by the public site and admin portal.",
        searchText: "tourist traveler repeat customer operations admin personas audience",
      },
      {
        id: "functional-requirements",
        title: "Functional Requirements",
        summary: "Public booking, deposit collection, admin portal capabilities, and notification requirements.",
        searchText: "public pages fleet booking creation deposits balance options admin portal notifications",
      },
      {
        id: "non-functional-requirements",
        title: "Non-Functional Requirements",
        summary: "Performance, security, payment, SEO, reliability, and accessibility expectations.",
        searchText: "security csrf sessions bcrypt rate limiting audit logs hosted checkout seo reliability accessibility",
      },
      {
        id: "site-map-information-architecture",
        title: "Site Map & Information Architecture",
        summary: "Route inventory for public pages, admin screens, and nested booking/payment flows.",
        searchText: "routes sitemap information architecture pages admin documentation security",
      },
      {
        id: "booking-flow-diagram",
        title: "Booking Flow Diagram",
        summary: "High-level customer booking and deposit payment flow with return and webhook reconciliation.",
        searchText: "booking flow deposit payment wipay return webhook reconciliation success failed",
      },
      {
        id: "user-stories",
        title: "User Stories",
        summary: "Customer and admin use cases that drive booking, payment, and operational workflows.",
        searchText: "customer stories admin stories reconcile webhooks reminders health checklist",
      },
    ],
  },
  {
    slug: "design",
    label: "Design Documentation",
    description:
      "Visual/UX guidance for the public site and admin UI, including brand tokens and accessibility standards.",
    topics: ["Brand guidelines", "Wireframes & mockups", "UI style guide", "WCAG accessibility"],
    blocks: [
      {
        id: "design-system-diagram",
        title: "Design System Diagram",
        summary: "How themes and tokens feed components, sections, and pages.",
        searchText: "design system tokens components sections pages theme diagram",
      },
      {
        id: "brand-guidelines",
        title: "Brand Guidelines",
        summary: "Light and dark theme tokens, typography, shape, and imagery guidance.",
        searchText: "brand light dark theme typography imagery tokens globals css",
      },
      {
        id: "wireframes-mockups",
        title: "Wireframes & Mockups",
        summary: "Required public and admin screens to be represented in design tooling.",
        searchText: "figma wireframes mockups public admin screens",
      },
      {
        id: "ui-style-guide",
        title: "UI Style Guide",
        summary: "Button, form, card, and layout conventions used across the site and admin UI.",
        searchText: "buttons forms cards layout components style guide",
      },
      {
        id: "accessibility-standards",
        title: "Accessibility Standards (WCAG)",
        summary: "WCAG-oriented keyboard, focus, semantics, and contrast requirements.",
        searchText: "wcag accessibility keyboard focus contrast headings semantic labels",
      },
    ],
  },
  {
    slug: "integrations",
    label: "Integrations & Documents",
    description:
      "Operational reference for payment modes, PDF provider setup, template previews, and email attachment behavior.",
    topics: ["WiPay payment flows", "Resend email flows", "Invoice/Quote providers", "Retention jobs"],
    blocks: [
      {
        id: "payment-integration-matrix",
        title: "Payment Integration Matrix (WiPay + Admin)",
        summary: "Deposit, balance, full, and custom payment routes plus return and webhook reconciliation.",
        searchText: "wipay deposit balance full custom return webhook payments",
      },
      {
        id: "invoice-quote-agreement-pipeline",
        title: "Invoice / Quote / Agreement Pipeline",
        summary: "How invoice, quote, agreement, and template preview document flows are generated.",
        searchText: "invoice quote agreement pdf gotenberg pdfmonkey template lab documents",
      },
      {
        id: "email-attachment-behavior",
        title: "Email Attachment Behavior",
        summary: "Which booking and quote emails include generated documents or fall back gracefully.",
        searchText: "email attachments quote booking invoice agreement signature fallback",
      },
      {
        id: "scheduled-data-retention-jobs",
        title: "Scheduled Data Retention Jobs",
        summary: "Archive cleanup and reminder cron jobs that operate across documents and notifications.",
        searchText: "retention cleanup archive files cron pickup balance note maintenance reminders",
      },
    ],
  },
  {
    slug: "technical",
    label: "Technical Documentation",
    description:
      "Developer-facing documentation: stack, APIs, database schema, hosting, and deployment environment.",
    topics: [
      "Technology stack",
      "API endpoints",
      "Database schema",
      "Hosting & deployment",
      "Repo structure",
    ],
    blocks: [
      {
        id: "system-architecture-diagram",
        title: "System Architecture Diagram",
        summary: "High-level architecture connecting Next.js, Postgres, payments, email, PDF, and cron.",
        searchText: "system architecture nextjs neon postgres wipay resend pdf cron netlify",
      },
      {
        id: "technology-stack",
        title: "Technology Stack",
        summary: "Framework, database, auth, payments, hosting, uploads, and document provider stack.",
        searchText: "nextjs react tailwind postgres neon auth bcrypt wipay resend gotenberg pdfmonkey uploadcare netlify",
      },
      {
        id: "api-documentation-key-endpoints",
        title: "API Documentation (Key Endpoints)",
        summary: "Public, payments, admin, health, security, and cron endpoints used by the platform.",
        searchText: "api endpoints public payments admin health csrf cron docs quotes promos",
      },
      {
        id: "database-schema-high-level",
        title: "Database Schema (High Level)",
        summary: "Core Postgres tables for users, bookings, vehicles, payments, blockouts, and audit data.",
        searchText: "database schema users vehicles customers bookings payments blockouts audit logs webhook events admin documents",
      },
      {
        id: "erd-diagram-high-level",
        title: "ERD Diagram (High Level)",
        summary: "Simplified entity relationship diagram for the main operational tables.",
        searchText: "erd relationships bookings customers vehicles payments audit logs webhook events",
      },
      {
        id: "hosting-server-environment",
        title: "Hosting & Server Environment",
        summary: "Netlify, Neon, cron, uploads, invoice provider, and environment variable overview.",
        searchText: "hosting server environment netlify database url site url cron secret env vars",
      },
      {
        id: "production-go-live-checklist",
        title: "Production Go-Live Checklist",
        summary: "Deployment, provider, secret, cron, smoke-test, and rollback checks before production launch.",
        searchText: "go live checklist production deploy dns tls backup wipay resend invoices uploads security rollback",
      },
      {
        id: "developer-workflow-code-documentation",
        title: "Developer Workflow & Code Documentation",
        summary: "Local development commands, key folders, and source-of-truth change logging guidance.",
        searchText: "developer workflow npm run dev build lint folders git change log notes",
      },
    ],
  },
  {
    slug: "security",
    label: "Security",
    description:
      "Consolidated security guidance for access control, authentication, webhook verification, auditability, and operational hardening.",
    topics: [
      "Roles & access control",
      "Authentication & sessions",
      "CSRF protection",
      "Webhooks & cron verification",
      "Audit logs",
      "Secrets & operational safety",
      "Uploads & document handling",
    ],
    blocks: [
      {
        id: "security-overview",
        title: "Security Overview",
        summary: "Trust boundaries, admin-only surfaces, third-party providers, and core security principles.",
        searchText: "trust boundaries admin public providers least privilege security overview",
      },
      {
        id: "access-roles",
        title: "Access & Roles",
        summary: "Role boundaries, least privilege expectations, and admin-only action guidance.",
        searchText: "roles access control admin only developer least privilege user management",
      },
      {
        id: "authentication-session-security",
        title: "Authentication & Session Security",
        summary: "Password storage, session cookies, login protection, CSRF, and secret management.",
        searchText: "authentication sessions cookies bcrypt login rate limit csrf admin session secret",
      },
      {
        id: "payments-webhooks-cron-verification",
        title: "Payments, Webhooks & Cron Verification",
        summary: "Hosted checkout boundaries, webhook idempotency, cron secret validation, and simulation limits.",
        searchText: "payments webhooks verification idempotency cron secret hosted checkout simulation",
      },
      {
        id: "data-handling-files-auditability",
        title: "Data Handling, Files & Auditability",
        summary: "Sensitive data handling, documents/uploads, audit logs, and retention-sensitive areas.",
        searchText: "data handling documents uploads signatures audit logs retention privacy files",
      },
      {
        id: "operational-security-checklist",
        title: "Operational Security Checklist",
        summary: "Secrets rotation, release checks, smoke tests, and incident-response expectations.",
        searchText: "operational security checklist rotate secrets smoke test release incident response health",
      },
    ],
  },
  {
    slug: "operations",
    label: "Operational & User Documentation",
    description:
      "Runbooks for day-to-day usage: content updates, roles, maintenance, support, and troubleshooting.",
    topics: ["Content updates", "User roles", "Maintenance plan", "Troubleshooting"],
    blocks: [
      {
        id: "booking-lifecycle-diagram",
        title: "Booking Lifecycle Diagram",
        summary: "Booking states and how reminder jobs relate to confirmed, picked-up, and cancelled bookings.",
        searchText: "booking lifecycle confirmed picked up returned cancelled pickup reminders balance reminders",
      },
      {
        id: "content-management-guide",
        title: "Content Management Guide",
        summary: "How code-managed content, fleet data, and documentation notes are maintained.",
        searchText: "content management src data vehicles services content admin documentation notes",
      },
      {
        id: "user-roles-capabilities",
        title: "User Roles & Capabilities",
        summary: "Operational meaning of user roles and where feature access is currently limited.",
        searchText: "user roles capabilities admin user permissions access portal",
      },
      {
        id: "maintenance-support-plan",
        title: "Maintenance & Support Plan",
        summary: "Backups, secret rotation, monitoring, and post-deploy validation guidance.",
        searchText: "maintenance support backups secret rotation monitoring health logs cron updates",
      },
      {
        id: "troubleshooting-guide",
        title: "Troubleshooting Guide",
        summary: "Common operational failures for DB, CSRF, payments, email, invoices, and cron reminders.",
        searchText: "troubleshooting database csrf wipay resend invoices cron reminders errors",
      },
    ],
  },
  {
    slug: "legal",
    label: "Legal & Compliance",
    description:
      "Policy templates and compliance notes. Review with qualified counsel before publishing.",
    topics: ["Privacy policy", "Terms & conditions", "Cookie policy", "PCI considerations"],
    blocks: [
      {
        id: "data-processing-diagram",
        title: "Data Processing Diagram",
        summary: "High-level map of customer, payment, email, document, upload, and cron data processors.",
        searchText: "data processing privacy wipay resend pdf provider uploadcare cron processors",
      },
      {
        id: "privacy-policy-template-outline",
        title: "Privacy Policy (Template Outline)",
        summary: "Collected data, processors, payment metadata, retention, and user rights guidance.",
        searchText: "privacy policy collected data processors retention access deletion requests",
      },
      {
        id: "terms-conditions-template-outline",
        title: "Terms & Conditions (Template Outline)",
        summary: "Rental rules, deposit policy, cancellations, liability, and late-return terms.",
        searchText: "terms conditions rental eligibility deposit refund cancellation liability dispute",
      },
      {
        id: "cookie-policy",
        title: "Cookie Policy",
        summary: "Session cookie, CSRF token, and future analytics consent considerations.",
        searchText: "cookie policy admin session cookie csrf analytics consent",
      },
      {
        id: "compliance-notes",
        title: "Compliance Notes",
        summary: "PCI scope, OWASP-aligned controls, data protection, and access-control considerations.",
        searchText: "compliance pci owasp sessions password storage rate limiting data protection access control",
      },
    ],
  },
  {
    slug: "project-management",
    label: "Project Management",
    description:
      "Planning and governance templates: milestones, change log process, and resourcing templates.",
    topics: ["Timeline", "Milestones", "Budget & resources", "Change log"],
    blocks: [
      {
        id: "timeline-diagram",
        title: "Timeline Diagram",
        summary: "Delivery sequence from discovery through go-live and monitoring.",
        searchText: "timeline discovery design build integrate uat go live monitoring",
      },
      {
        id: "timeline-milestones-template",
        title: "Timeline & Milestones (Template)",
        summary: "Milestone checklist spanning discovery, design, build, integrations, testing, and launch.",
        searchText: "milestones timeline discovery design build integrations testing launch",
      },
      {
        id: "budget-resource-allocation-template",
        title: "Budget & Resource Allocation (Template)",
        summary: "Owners, budgets, and resourcing across product, design, engineering, ops, and tools.",
        searchText: "budget resources owners product design engineering operations tools",
      },
      {
        id: "change-log",
        title: "Change Log",
        summary: "Suggested release/change logging format alongside git history and documentation notes.",
        searchText: "change log release notes owner type summary impact rollout backout git history",
      },
    ],
  },
] as const satisfies readonly DocumentationSectionMeta[];

export const DOCUMENTATION_SECTION_LINKS: readonly DocumentationSectionLink[] =
  DOCUMENTATION_CATALOG.map((section) => ({
    href: `/admin/documentation/${section.slug}`,
    label: section.label,
    description: section.description,
    topics: section.topics,
  }));

export const DOCUMENTATION_SECTION_CHILDREN = DOCUMENTATION_SECTION_LINKS.map((section) => ({
  label: section.label,
  href: section.href,
}));

export function getDocumentationSectionMeta(slug: string) {
  return DOCUMENTATION_CATALOG.find((section) => section.slug === slug);
}

export function getDocumentationBlockMeta(slug: string, title: string) {
  return getDocumentationSectionMeta(slug)?.blocks.find((block) => block.title === title);
}

export function buildDocumentationSearchEntries(notesContent: string): DocumentationSearchEntry[] {
  const entries: DocumentationSearchEntry[] = [];

  for (const section of DOCUMENTATION_CATALOG) {
    const sectionSearchText = compactText(
      [section.label, section.description, ...section.topics].join(" "),
    );
    entries.push({
      id: `section:${section.slug}`,
      type: "section",
      href: `/admin/documentation/${section.slug}`,
      sectionLabel: section.label,
      title: section.label,
      snippet: section.description,
      snippetSource: sectionSearchText,
      searchText: sectionSearchText,
    });

    for (const block of section.blocks) {
      const snippet = compactText(block.summary);
      const searchText = compactText(
        [section.label, ...section.topics, block.title, block.summary, block.searchText].join(" "),
      );
      entries.push({
        id: `topic:${section.slug}:${block.id}`,
        type: "topic",
        href: `/admin/documentation/${section.slug}#${block.id}`,
        sectionLabel: section.label,
        title: block.title,
        snippet,
        snippetSource: `${block.title}. ${snippet}. ${block.searchText}`,
        searchText,
      });
    }
  }

  const trimmedNotes = compactText(notesContent);
  if (trimmedNotes) {
    entries.push({
      id: "notes:documentation",
      type: "notes",
      href: "/admin/documentation#notes-change-log",
      sectionLabel: "Documentation Home",
      title: "Notes & Change Log",
      snippet: "Team release notes, reminders, and documentation updates.",
      snippetSource: trimmedNotes,
      searchText: compactText(`documentation notes change log ${trimmedNotes}`),
    });
  }

  return entries;
}

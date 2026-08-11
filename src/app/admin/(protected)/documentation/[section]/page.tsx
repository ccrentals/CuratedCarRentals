import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { resolveAdminActor } from "@/lib/auth/adminGuards";
import {
  getDocumentationBlockMeta,
  getDocumentationSectionMeta,
  DOCUMENTATION_SECTION_LINKS,
  toDocumentationAnchorId,
} from "@/lib/documentation/catalog";

const SVG_FONT_FAMILY =
  "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

type DocBlock = {
  title: string;
  content: ReactNode;
};

type DocSection = {
  title: string;
  description: string;
  blocks: DocBlock[];
};

function Card({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6"
    >
      <h2 className="text-lg font-bold text-[var(--ccr-text)]">{title}</h2>
      <div className="mt-2 space-y-3 text-[var(--ccr-muted)]">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto whitespace-pre rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 text-xs text-[var(--ccr-text)]">
      {children}
    </pre>
  );
}

function DiagramFrame({
  title,
  description,
  children,
  fallbackText,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  fallbackText?: string;
}) {
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-[var(--ccr-text)]">{title}</p>
      {description ? <p className="mt-1 text-sm text-[var(--ccr-muted)]">{description}</p> : null}
      <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4">
        {children}
      </div>
      {fallbackText ? (
        <details className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
            View diagram as text
          </summary>
          <CodeBlock>{fallbackText}</CodeBlock>
        </details>
      ) : null}
    </div>
  );
}

type SvgBoxProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines?: string[];
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  titleFill?: string;
  lineFill?: string;
};

function SvgBox({
  x,
  y,
  width,
  height,
  title,
  lines = [],
  fill = "var(--ccr-surface)",
  fillOpacity = 1,
  stroke = "var(--ccr-border)",
  strokeOpacity = 1,
  titleFill = "var(--ccr-text)",
  lineFill = "var(--ccr-muted)",
}: SvgBoxProps) {
  const paddingX = 14;
  const titleY = y + 24;
  const lineStartY = titleY + 18;
  const lineHeight = 16;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={16}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={1.2}
      />
      <text
        x={x + paddingX}
        y={titleY}
        fill={titleFill}
        fontSize={14}
        fontWeight={800}
        fontFamily={SVG_FONT_FAMILY}
        letterSpacing="0.2px"
      >
        {title}
      </text>
      {lines.map((line, index) => (
        <text
          key={`${title}:${index}`}
          x={x + paddingX}
          y={lineStartY + index * lineHeight}
          fill={lineFill}
          fontSize={12}
          fontWeight={600}
          fontFamily={SVG_FONT_FAMILY}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function SvgArrow({
  d,
  markerId,
  dashed,
  label,
  labelX,
  labelY,
}: {
  d: string;
  markerId: string;
  dashed?: boolean;
  label?: string;
  labelX?: number;
  labelY?: number;
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="var(--ccr-muted)"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "6 6" : undefined}
        markerEnd={`url(#${markerId})`}
      />
      {label && typeof labelX === "number" && typeof labelY === "number" ? (
        <text
          x={labelX}
          y={labelY}
          fill="var(--ccr-muted)"
          fontSize={11}
          fontWeight={700}
          fontFamily={SVG_FONT_FAMILY}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

const SITE_MAP = `Public
- /
- /fleet
- /fleet/[id]
- /book
- /book/checkout
- /services
- /tourist-destinations
- /about
- /contact
- /bookings/[id]
  - /bookings/[id]/pay
  - /bookings/[id]/balance
  - /bookings/[id]/invoice
- /payment/success
- /payment/failed

Admin (requires login)
- /admin/login
- /admin/set-password
- /admin
- /admin/bookings
  - /admin/bookings/[id]
  - /admin/bookings/archive
  - /admin/bookings/quotes
  - /admin/bookings/quotes/[id]
- /admin/customers
  - /admin/customers/[id]
- /admin/messages
- /admin/vehicles
  - /admin/vehicles/[vehicleId]
- /admin/payments
- /admin/calendar
- /admin/promo-codes
- /admin/maintenance
- /admin/depreciation
- /admin/reports
- /admin/cron
- /admin/settings
- /admin/health
- /admin/users
- /admin/profile
- /admin/template-lab
- /admin/developer
- /admin/documentation
  - /admin/documentation/prd
- /admin/documentation/design
- /admin/documentation/integrations
- /admin/documentation/technical
- /admin/documentation/security
- /admin/documentation/operations
- /admin/documentation/legal
- /admin/documentation/project-management`;

const BOOKING_FLOW_DIAGRAM = `Customer booking + deposit (high level)

[Browse Fleet]                 [Create booking request]
/fleet  -------------------->  /book
                                 |
                                 v
                           POST /api/public/bookings
                                 |
                                 v
                        bookings.status = PENDING_PAYMENT
                                 |
                                 v
                    /bookings/[id] (customer sees totals)
                                 |
                                 v
                 "Deposit due now" + "Balance due on pickup"
                                 |
                                 v
                      POST /api/payments/start (CSRF)
                                 |
                                 v
                   Configured provider checkout page
                         /\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\
                    (card details handled by provider)
                         \\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/
                          |                     |
                          | (return redirect)    | (webhook)
                          v                     v
          Provider return route              Provider webhook route
                          |                     |
                          +----------+----------+
                                     v
                           reconcile + update payment state
                                     |
                                     v
                         /payment/success or /payment/failed
                                     |
                                     v
                           Admin collects balance on pickup`;

const SYSTEM_ARCH_DIAGRAM = `System architecture (simplified)

                 +----------------------+
                 |   Customer Browser   |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 |  Next.js App (Web)   |
                 |  - Public pages      |
                 |  - Admin portal      |
                 |  - API routes        |
                 +----+----+----+-------+
                      |    |    |
          +-----------+    |    +--------------------+
          |                |                         |
          v                v                         v
 +----------------+  +--------------+        +----------------------+
 | Neon Postgres  |  | Payments     |        | Resend + PDF Engine  |
 | (DATABASE_URL) |  | (Stripe/WiPay)|       | (Gotenberg/PDFMonkey)|
 +----------------+  +--------------+        +----------------------+
                      ^      |
                      |      v
                  (return) (webhook)

 +----------------------+
 | Netlify Scheduled    |
 | Functions (cron)     |
 +----------+-----------+
            |
            v
  POST /api/cron/* (x-cron-secret) -> emails/reminders`;

const ERD_DIAGRAM = `Data model (high level)

users (1) ---- (N) audit_logs
users (1) ---- (N) admin_login_attempts
users (1) ---- (N) user_invites

vehicles (1) ---- (N) bookings ---- (1) customers
vehicles (1) ---- (N) blockouts

bookings (1) ---- (N) payments
webhook_events: provider event de-dupe (idempotency)
admin_documents: key/value docs + notes storage`;

const DESIGN_SYSTEM_DIAGRAM = `Design system layers (high level)

Theme (light/dark)
   |
   v
Design tokens (CSS variables in globals.css)
   |
   v
UI components (Button, cards, form fields)
   |
   v
Sections (hero, grids, summaries)
   |
   v
Pages/routes (public + admin)`;

const BOOKING_LIFECYCLE_DIAGRAM = `Booking lifecycle (simplified)

PENDING_PAYMENT -> CONFIRMED -> PICKED_UP -> RETURNED
        |              |
        |              +-> CANCELLED (edge cases)
        |
        +-> CANCELLED

Reminders (cron)
- Pickup reminder: 1 day before start_date (for CONFIRMED/PICKED_UP)
- Balance reminder: on/after start_date while balance_due > 0 (for CONFIRMED/PICKED_UP)
- Note emails: due_at <= now() and not yet sent/cancelled`;

const DATA_PROCESSING_DIAGRAM = `Data processing map (high level)

Customer submits booking details -> Next.js API -> Neon Postgres
Deposit checkout -> selected hosted payment provider -> return/webhook -> reconcile in Neon
Emails -> Resend
Invoices -> configured provider (Gotenberg or PDFMonkey)
Quotes -> native PDF generation endpoint
Uploads -> Bunny Storage (public + private); Uploadcare legacy fallback during migration
Scheduled reminders -> Netlify cron -> /api/cron/* -> Resend`;

const PROJECT_TIMELINE_DIAGRAM = `Delivery timeline (template)

Discovery/PRD -> Design -> Build -> Integrations -> UAT -> Go-live -> Monitoring`;

const DOCS: Record<string, DocSection> = {
  prd: {
    title: "PRD / Specification",
    description:
      "Defines the scope, goals, users, and requirements for the Curated Car Rentals website and admin portal.",
    blocks: [
      {
        title: "Purpose & Goals (SMART)",
        content: (
          <>
            <p>
              Curated Car Rentals supports a public booking flow (with online deposits) and an internal admin portal for
              managing the fleet and bookings. Goals should be set as SMART targets and reviewed monthly.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Increase booking requests:</span> Improve booking
                form completion rate to a defined target (e.g. 25% uplift) within 90 days of go-live.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Reduce admin time:</span> Cut time-to-confirm a
                booking by a defined target (e.g. 30%) by centralizing booking details, payments, and reminders.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Increase deposit collection:</span> Ensure deposit
                payments are initiated for a defined percentage of bookings (e.g. 80%) within 24 hours of request.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Operational readiness:</span> Maintain a “go-live
                ready” health status (see <code>/admin/health</code>) with all required integrations passing.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Target Audience (Personas)",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Tourist Planner:</span> Researches vehicles and
                policies ahead of travel; values trust, clarity, and simple booking.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Last‑Minute Traveler:</span> Wants quick checkout
                and immediate confirmation; needs mobile-first UX.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Local / Repeat Customer:</span> Looks for pricing
                transparency and smooth communication.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Operations Admin:</span> Manages bookings,
                vehicles, availability, payments, and reminders; needs reliability and auditability.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Functional Requirements",
        content: (
          <>
            <p>
              The product consists of a public marketing + booking experience and an authenticated admin portal.
              Deposits are collected online; balances are due on pickup.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Public pages:</span> Home, Fleet, Services,
                Destinations, About, Contact.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Fleet browsing:</span> Display available vehicles
                (DB-backed via <code>/api/public/vehicles</code>) with current pricing/deposit metadata.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Booking creation:</span> Booking form captures
                vehicle, dates, pickup location, and customer contact details; validates inputs and availability.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Deposits:</span> Start a hosted WiPay checkout for
                the deposit amount due now; redirect back to success/failure pages and reconcile by webhook/return.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Balance options:</span> Remaining balance can be paid
                on pickup or online (when the customer selects pay balance/full flow).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Admin portal:</span> Login, dashboard, bookings
                list + detail, quotes, customers, vehicles list + detail, payments, promo codes, calendar + blockouts,
                maintenance, depreciation, reports, cron runner, health, documentation, users, settings, profile, and template
                previews.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Notifications:</span> Booking received emails,
                rental-agreement emails, reminders (pickup/balance/notes), and invoice/quote emails.
              </li>
            </ul>
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Out of scope (for now)</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ccr-muted)]">
                <li>Automated refunds/chargebacks.</li>
                <li>Customer accounts and self-serve booking changes.</li>
              </ul>
            </div>
          </>
        ),
      },
      {
        title: "Non-Functional Requirements",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Performance:</span> Fast page loads on mobile,
                optimized images, and sensible caching; keep key pages responsive under typical traffic.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Security:</span> CSRF protection for state-changing
                requests, HttpOnly session cookies for admin, bcrypt password hashes, rate-limited login, audit logs for
                key actions.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Payments:</span> PCI handled by hosted checkout;
                store only necessary transaction references and reconciliation metadata.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">SEO:</span> Clear metadata on public pages,
                descriptive headings, and linkable routes; avoid blocking indexing accidentally.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Reliability:</span> Health endpoints and admin
                health dashboard for go-live checks; webhook handling should be idempotent.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Accessibility:</span> WCAG-aligned forms,
                keyboard navigation, visible focus, and sufficient contrast.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Site Map & Information Architecture",
        content: (
          <>
            <p>High-level route hierarchy:</p>
            <CodeBlock>{SITE_MAP}</CodeBlock>
          </>
        ),
      },
      {
        title: "Booking Flow Diagram",
        content: (
          <>
            <p className="mb-3 text-sm text-[var(--ccr-muted)]">
              Rollout note: the booking-location builder and config-driven booking, quote, and public
              location flows require <code>044_booking_location_config.sql</code> before promotion to
              staging or production. Apply the migration first, then smoke-test
              <code> /api/public/locations</code>, <code>/admin/settings</code>, and the booking edit flow.
            </p>
            <DiagramFrame
              title="Customer booking + deposit (high level)"
              description="Shows “deposit due now” flow and how return + webhook reconciliation work."
              fallbackText={BOOKING_FLOW_DIAGRAM}
            >
                <svg
                  viewBox="0 0 960 520"
                  role="img"
                  aria-labelledby="booking-flow-title booking-flow-desc"
                  className="h-auto w-full min-w-[860px]"
                >
                <title id="booking-flow-title">Customer booking and deposit payment flow</title>
                <desc id="booking-flow-desc">
                  Fleet browsing, booking creation, deposit checkout via WiPay, reconciliation via return and webhook, and final status pages.
                </desc>
                <defs>
                  <marker
                    id="arrow-booking-flow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox x={70} y={50} width={120} height={72} title="Fleet" lines={["/fleet", "Browse cars"]} />
                <SvgBox x={210} y={50} width={120} height={72} title="Book" lines={["/book", "Enter details"]} />
                <SvgBox
                  x={350}
                  y={50}
                  width={120}
                  height={72}
                  title="API"
                  lines={["POST", "/api/public/bookings"]}
                  fill="var(--ccr-surface-soft)"
                />
                <SvgBox
                  x={490}
                  y={50}
                  width={120}
                  height={72}
                  title="Booking"
                  lines={["status:", "PENDING_PAYMENT"]}
                  fill="var(--ccr-surface-soft)"
                />
                <SvgBox
                  x={630}
                  y={50}
                  width={120}
                  height={72}
                  title="Pay deposit"
                  lines={["POST", "/api/payments/wipay/start"]}
                  fill="var(--ccr-surface-soft)"
                />
                <SvgBox
                  x={770}
                  y={50}
                  width={120}
                  height={72}
                  title="WiPay"
                  lines={["Hosted checkout", "Card handled off-site"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.14}
                  stroke="var(--ccr-accent-strong)"
                />

                <SvgArrow d="M190 86 L210 86" markerId="arrow-booking-flow" />
                <SvgArrow d="M330 86 L350 86" markerId="arrow-booking-flow" />
                <SvgArrow d="M470 86 L490 86" markerId="arrow-booking-flow" />
                <SvgArrow d="M610 86 L630 86" markerId="arrow-booking-flow" />
                <SvgArrow d="M750 86 L770 86" markerId="arrow-booking-flow" />

                <SvgBox
                  x={770}
                  y={170}
                  width={120}
                  height={72}
                  title="Return"
                  lines={["GET", "/api/payments/wipay/return"]}
                />
                <SvgBox
                  x={770}
                  y={260}
                  width={120}
                  height={72}
                  title="Webhook"
                  lines={["POST", "/api/payments/wipay/webhook"]}
                />

                <SvgArrow
                  d="M830 122 L830 170"
                  markerId="arrow-booking-flow"
                  label="redirect"
                  labelX={842}
                  labelY={152}
                />
                <SvgArrow
                  d="M830 122 L910 122 L910 260 L830 260"
                  markerId="arrow-booking-flow"
                  dashed
                  label="webhook"
                  labelX={842}
                  labelY={216}
                />

                <SvgBox
                  x={520}
                  y={220}
                  width={220}
                  height={92}
                  title="Reconcile"
                  lines={["Validate + update payment", "Update booking status"]}
                  fill="var(--ccr-surface)"
                />
                <SvgArrow
                  d="M770 206 L740 266"
                  markerId="arrow-booking-flow"
                  label="return"
                  labelX={676}
                  labelY={208}
                />
                <SvgArrow
                  d="M770 296 L740 266"
                  markerId="arrow-booking-flow"
                  dashed
                  label="webhook"
                  labelX={676}
                  labelY={300}
                />
                
                <SvgBox
                  x={520}
                  y={340}
                  width={220}
                  height={92}
                  title="Result"
                  lines={["/payment/success", "or /payment/failed"]}
                  fill="var(--ccr-surface)"
                />
                <SvgArrow d="M630 312 L630 340" markerId="arrow-booking-flow" />

                <SvgBox
                  x={770}
                  y={340}
                  width={160}
                  height={92}
                  title="Pickup"
                  lines={["Balance due", "on pickup (admin)"]}
                  fill="var(--ccr-primary)"
                  fillOpacity={0.08}
                  stroke="var(--ccr-primary-soft)"
                  strokeOpacity={0.6}
                />
                <SvgArrow d="M740 386 L770 386" markerId="arrow-booking-flow" />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "User Stories",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>As a customer, I want to browse vehicles so I can choose the best option for my trip.</li>
              <li>As a customer, I want to submit a booking request so I can reserve a vehicle for specific dates.</li>
              <li>As a customer, I want to pay a deposit online so my booking can be confirmed faster.</li>
              <li>As a customer, I want to clearly see “due now” vs “due on pickup” so I understand total cost.</li>
              <li>As an admin, I want to review bookings so I can confirm pickup details and handle changes.</li>
              <li>As an admin, I want to manage vehicle availability with blockouts so maintenance doesn’t cause conflicts.</li>
              <li>As an admin, I want to reconcile payment webhooks safely so duplicate events don’t create double payments.</li>
              <li>As an admin, I want to run reminders so customers are notified before pickup and balance due dates.</li>
              <li>As an admin, I want a health checklist so I can verify integrations before going live.</li>
            </ul>
          </>
        ),
      },
    ],
  },
  design: {
    title: "Design Documentation",
    description:
      "Visual/UX guidance for the public site and admin UI, including brand tokens and accessibility standards.",
    blocks: [
      {
        title: "Design System Diagram",
        content: (
          <>
            <DiagramFrame
              title="Design system layers"
              description="How brand tokens flow into components, sections, and pages."
              fallbackText={DESIGN_SYSTEM_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 320"
                role="img"
                aria-labelledby="design-system-title design-system-desc"
                className="h-auto w-full min-w-[860px]"
              >
                <title id="design-system-title">Design system layers</title>
                <desc id="design-system-desc">
                  Theme and tokens feed components, which feed sections, which feed pages.
                </desc>
                <defs>
                  <marker
                    id="arrow-design-system"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox
                  x={70}
                  y={60}
                  width={190}
                  height={90}
                  title="Theme"
                  lines={["Light / Dark", "User toggle"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.14}
                  stroke="var(--ccr-accent-strong)"
                />
                <SvgBox
                  x={290}
                  y={60}
                  width={190}
                  height={90}
                  title="Tokens"
                  lines={["CSS variables", "globals.css"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={510}
                  y={60}
                  width={190}
                  height={90}
                  title="Components"
                  lines={["Button, cards,", "form fields"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={730}
                  y={60}
                  width={190}
                  height={90}
                  title="Sections"
                  lines={["Hero, grids,", "summaries"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={400}
                  y={200}
                  width={260}
                  height={90}
                  title="Pages / Routes"
                  lines={["Public + Admin", "Next.js App Router"]}
                  fill="var(--ccr-surface-soft)"
                />

                <SvgArrow d="M260 105 L290 105" markerId="arrow-design-system" />
                <SvgArrow d="M480 105 L510 105" markerId="arrow-design-system" />
                <SvgArrow d="M700 105 L730 105" markerId="arrow-design-system" />

                <SvgArrow
                  d="M825 150 L825 170 L660 170 L660 200"
                  markerId="arrow-design-system"
                  label="composed into"
                  labelX={692}
                  labelY={164}
                />
                <SvgArrow
                  d="M385 150 L385 170 L400 170"
                  markerId="arrow-design-system"
                  label="drives"
                  labelX={328}
                  labelY={164}
                />
                <SvgArrow d="M605 150 L605 200" markerId="arrow-design-system" dashed label="uses" labelX={618} labelY={186} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Brand Guidelines",
        content: (
          <>
            <p>
              The UI uses CSS variables as design tokens (see <code>src/app/globals.css</code>) with light and dark theme
              values.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Light theme</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li><code>--ccr-bg</code>: #f5f7fc</li>
                  <li><code>--ccr-text</code>: #1a243b</li>
                  <li><code>--ccr-primary</code>: #1f2d4d</li>
                  <li><code>--ccr-accent</code>: #f5b41b</li>
                  <li><code>--ccr-accent-strong</code>: #d69305</li>
                </ul>
              </div>
              <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Dark theme</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li><code>--ccr-bg</code>: #0d1427</li>
                  <li><code>--ccr-text</code>: #e8edf8</li>
                  <li><code>--ccr-primary</code>: #111a31</li>
                  <li><code>--ccr-accent</code>: #f8c648</li>
                  <li><code>--ccr-accent-strong</code>: #e4a611</li>
                </ul>
              </div>
            </div>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Typography:</span> Geist Sans + Geist Mono via{" "}
                <code>next/font</code> (see <code>src/app/layout.tsx</code>).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Shape:</span> Rounded corners are typically{" "}
                <code>rounded-xl</code> to <code>rounded-3xl</code> for a modern “card” look.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Imagery:</span> Clean vehicle photos; avoid noisy
                backgrounds; keep consistent aspect ratios per component.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Wireframes & Mockups",
        content: (
          <>
            <p>
              Wireframes and final mockups should be maintained in a design tool (e.g., Figma). Use the route map in the
              PRD to define required screens.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Public: Home, Fleet, Vehicle cards, Booking form, Booking status, Payment success/failure.</li>
              <li>Admin: Login, Dashboard, Bookings list/detail, Vehicles list/detail, Payments, Calendar, Reports, Health.</li>
            </ul>
          </>
        ),
      },
      {
        title: "UI Style Guide",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Buttons:</span> <code>src/components/ui/Button.tsx</code>{" "}
                defines primary (accent) and secondary (surface) variants with hover states.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Forms:</span> Labels are visible; inputs use
                borders and focus rings (accent) for clarity.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Cards:</span> Consistent borders (
                <code>--ccr-border</code>), surface backgrounds, and subtle shadows.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Layout:</span> Use the shared container and
                sections; keep max widths consistent with existing pages.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Accessibility Standards (WCAG)",
        content: (
          <>
            <p>
              Target WCAG 2.1 AA for public and admin experiences.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Keyboard navigability for all interactive elements.</li>
              <li>Visible focus states on inputs and links.</li>
              <li>Proper form labels and error messaging.</li>
              <li>Maintain color contrast (especially in dark mode).</li>
              <li>
                Use semantic headings (
                <code>h1</code>
                <DateRangeArrow />
                <code>h2</code>
                <DateRangeArrow />
                …) and meaningful link text.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  technical: {
    title: "Technical Documentation",
    description:
      "Developer-facing documentation: stack, APIs, DB schema, hosting, and project structure. See Security for auth, CSRF, webhook, and operational hardening specifics.",
    blocks: [
      {
        title: "System Architecture Diagram",
        content: (
          <>
            <DiagramFrame
              title="System architecture (simplified)"
              description="How the Next.js app connects to Postgres and third-party services."
              fallbackText={SYSTEM_ARCH_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 440"
                role="img"
                aria-labelledby="system-arch-title system-arch-desc"
                className="h-auto w-full min-w-[860px]"
              >
                <title id="system-arch-title">System architecture</title>
                <desc id="system-arch-desc">
                  Customer browser connects to Next.js app; app talks to Postgres and third party services; cron triggers reminders.
                </desc>
                <defs>
                  <marker
                    id="arrow-system-arch"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox
                  x={60}
                  y={60}
                  width={210}
                  height={92}
                  title="Customer"
                  lines={["Browser", "Public pages + booking"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={320}
                  y={45}
                  width={320}
                  height={122}
                  title="Next.js App"
                  lines={["Public + Admin UI", "API routes (server)"]}
                  fill="var(--ccr-surface-soft)"
                />
                <SvgBox
                  x={700}
                  y={45}
                  width={210}
                  height={92}
                  title="Payments"
                  lines={["Stripe or WiPay", "return + webhook"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.14}
                  stroke="var(--ccr-accent-strong)"
                />
                <SvgBox
                  x={700}
                  y={165}
                  width={210}
                  height={92}
                  title="Resend + PDF Engine"
                  lines={["Email + docs", "Gotenberg/PDFMonkey"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={60}
                  y={270}
                  width={210}
                  height={92}
                  title="Neon Postgres"
                  lines={["DATABASE_URL", "Bookings, vehicles, payments"]}
                  fill="var(--ccr-surface)"
                />
                <SvgBox
                  x={320}
                  y={270}
                  width={320}
                  height={92}
                  title="Netlify Cron"
                  lines={["Scheduled functions", "Calls /api/cron/*"]}
                  fill="var(--ccr-surface)"
                />

                <SvgArrow d="M270 106 L320 106" markerId="arrow-system-arch" label="HTTPS" labelX={286} labelY={94} />
                <SvgArrow d="M640 98 L700 98" markerId="arrow-system-arch" label="start" labelX={662} labelY={86} />
                <SvgArrow d="M700 120 L640 120" markerId="arrow-system-arch" dashed label="return/webhook" labelX={642} labelY={140} />
                <SvgArrow d="M640 180 L700 210" markerId="arrow-system-arch" dashed label="send" labelX={654} labelY={206} />
                <SvgArrow d="M420 167 L200 270" markerId="arrow-system-arch" label="read/write" labelX={262} labelY={232} />
                <SvgArrow d="M480 270 L480 167" markerId="arrow-system-arch" dashed label="jobs" labelX={492} labelY={232} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Technology Stack",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Framework:</span> Next.js App Router (TypeScript).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">UI:</span> React + Tailwind CSS; theme tokens in{" "}
                <code>src/app/globals.css</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Database:</span> Neon Postgres; access via{" "}
                <code>pg</code> using <code>src/lib/db.ts</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Auth:</span> Clerk-backed identity where enabled,
                bridged to the local <code>users.role</code> authorization record; the legacy signed admin-cookie path
                remains during the cutover.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Payments:</span> provider-selected hosted checkout
                (Stripe for the staging test flow; Stripe or WiPay in production according to deployment configuration),
                with return + webhook reconciliation.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Email & documents:</span> Resend for notifications;
                invoice provider is configurable via <code>PDF_PROVIDER</code> (<code>gotenberg</code> or{" "}
                <code>pdfmonkey</code>), and quote PDFs are generated natively.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Uploads:</span> Bunny Storage: a public Storage
                Zone + Pull Zone for public media and a separate private Storage Zone for customer and booking files.
                Uploadcare remains read-compatible only while historic files are migrated.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Hosting:</span> Netlify with{" "}
                <code>@netlify/plugin-nextjs</code>.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "API Documentation (Key Endpoints)",
        content: (
          <>
            <p className="text-[var(--ccr-text)] font-semibold">Public</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <code>GET /api/public/vehicles</code>
                <DateRangeArrow />
                <code>{`{ vehicles: VehicleRow[] }`}</code>
              </li>
              <li>
                <code>POST /api/public/bookings</code>
                <DateRangeArrow />
                creates a booking in <code>PENDING_PAYMENT</code> state.
              </li>
              <li>
                <code>POST /api/public/pricing/quote</code>
                <DateRangeArrow />
                returns computed totals (base, insurance, discount, due now, due on pickup).
              </li>
              <li>
                <code>POST /api/public/promos/validate</code>
                <DateRangeArrow />
                validates promo code applicability for the selected booking window.
              </li>
            </ul>

            <p className="mt-4 text-[var(--ccr-text)] font-semibold">Payments</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <code>POST /api/payments/start</code>
                <DateRangeArrow />
                starts the configured provider checkout and returns its hosted URL.
              </li>
              <li>
                <code>POST /api/payments/wipay/balance/start</code>
                <DateRangeArrow />
                starts hosted checkout for remaining balance.
              </li>
              <li>
                <code>POST /api/payments/wipay/full/start</code>
                <DateRangeArrow />
                starts hosted checkout for full amount.
              </li>
              <li>
                <code>GET /api/payments/wipay/return</code>
                <DateRangeArrow />
                provider redirect handler
                <DateRangeArrow />
                redirects to success/fail page.
              </li>
              <li>
                <code>POST /api/payments/wipay/webhook</code>
                <DateRangeArrow />
                reconcile WiPay events; Stripe uses <code>POST /api/payments/stripe/webhook</code> and
                <code> GET /api/payments/stripe/return</code>.
              </li>
            </ul>

            <p className="mt-4 text-[var(--ccr-text)] font-semibold">Admin</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <code>POST /api/admin/login</code>
                <DateRangeArrow />
                sets session cookie.
              </li>
              <li>
                <code>POST /api/admin/logout</code>
                <DateRangeArrow />
                clears session cookie.
              </li>
              <li>
                <code>GET /api/admin/me</code>
                <DateRangeArrow />
                returns current user summary.
              </li>
              <li>
                <code>GET/PATCH /api/admin/docs</code>
                <DateRangeArrow />
                documentation notes storage (DB table <code>admin_documents</code>).
              </li>
              <li>
                <code>/api/admin/quotes/*</code>
                <DateRangeArrow />
                quote CRUD, status transitions, PDF generation, and email send.
              </li>
              <li><code>/api/admin/*</code> resource routes for vehicles, bookings, payments, users, and blockouts.</li>
            </ul>

            <p className="mt-4 text-[var(--ccr-text)] font-semibold">Health & Security</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <code>GET /api/health/db</code>
                <DateRangeArrow />
                DB connectivity snapshot.
              </li>
              <li>
                <code>GET /api/health/ready</code>
                <DateRangeArrow />
                readiness status used by <code>/admin/health</code>.
              </li>
              <li>
                <code>GET /api/security/csrf</code>
                <DateRangeArrow />
                bootstrap CSRF token for protected requests.
              </li>
            </ul>
            <p className="mt-4 text-sm text-[var(--ccr-muted)]">
              For role boundaries, session protection, webhook verification, auditability, and secrets
              handling, see{" "}
              <Link href="/admin/documentation/security" className="font-semibold text-[var(--ccr-text)] underline">
                Security
              </Link>
              .
            </p>

            <p className="mt-4 text-[var(--ccr-text)] font-semibold">Cron</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <code>POST /api/cron/pickup-reminders</code>
                <DateRangeArrow />
                sends pickup reminder emails (requires <code>x-cron-secret</code>).
              </li>
              <li>
                <code>POST /api/cron/balance-reminders</code>
                <DateRangeArrow />
                sends balance reminder emails (requires <code>x-cron-secret</code>).
              </li>
              <li>
                <code>POST /api/cron/note-emails</code>
                <DateRangeArrow />
                sends scheduled note emails due at/earlier than current time.
              </li>
              <li>
                <code>POST /api/cron/maintenance-reminders</code>
                <DateRangeArrow />
                creates in-app maintenance reminders based on due date/odometer configuration.
              </li>
              <li>
                <code>POST /api/cron/archive-file-cleanup</code>
                <DateRangeArrow />
                hard-deletes archived vehicle documents older than 30 days.
              </li>
              <li>
                <code>POST /api/admin/cron/simulate-reminders</code>
                <DateRangeArrow />
                admin-only simulation mode for validating Last Runs + Recent Reminder Events without sending provider traffic.
              </li>
            </ul>

            <details className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Example: Create booking request (public)
              </summary>
              <CodeBlock>{`POST /api/public/bookings
Content-Type: application/json

{
  "vehicleId": "uuid",
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1 876 555 1234",
  "startDate": "2026-03-19",
  "endDate": "2026-03-21",
  "pickupLocation": "Montego Bay Airport"
}

200 OK
{
  "bookingId": "uuid",
  "status": "PENDING_PAYMENT"
}`}</CodeBlock>
            </details>

            <details className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Example: Start WiPay deposit payment
              </summary>
              <CodeBlock>{`POST /api/payments/wipay/start
Content-Type: application/json
x-csrf-token: <token>

{
  "bookingId": "uuid"
}

200 OK
{
  "ok": true,
  "redirectUrl": "https://...wipay...hosted-page...",
  "paymentId": "uuid"
}`}</CodeBlock>
            </details>
          </>
        ),
      },
      {
        title: "Database Schema (High Level)",
        content: (
          <>
            <p>
              Postgres schema is maintained in <code>db/schema.sql</code>. Key tables and relationships:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <code>users</code> — admin users (roles, lockout metadata, lifecycle fields).
              </li>
              <li>
                <code>vehicles</code> — fleet inventory (features + images stored as JSON).
              </li>
              <li>
                <code>customers</code> — customer contact records.
              </li>
              <li>
                <code>bookings</code> — references <code>vehicles</code> and <code>customers</code>; date-range constraints; pricing JSON.
              </li>
              <li>
                <code>payments</code> — references <code>bookings</code>; stores provider refs and reconciliation metadata.
              </li>
              <li>
                <code>blockouts</code> — references <code>vehicles</code>; maintenance/unavailable windows.
              </li>
              <li>
                <code>audit_logs</code> — admin/system action logs; <code>webhook_events</code> for webhook idempotency.
              </li>
              <li>
                <code>admin_documents</code> — key/value documentation notes (this page’s Notes editor).
              </li>
            </ul>
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Money fields</p>
              <p className="mt-2 text-sm">
                Columns named <code>*_cents</code> currently store JMD dollars as integers (legacy naming). Example:{" "}
                <code>3000</code> is treated as JMD 3,000.00.
              </p>
            </div>
          </>
        ),
      },
      {
        title: "ERD Diagram (High Level)",
        content: (
          <>
            <DiagramFrame
              title="Core data relationships"
              description="Simplified relationships between key entities (see db/schema.sql for the full DDL)."
              fallbackText={ERD_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 520"
                role="img"
                aria-labelledby="erd-title erd-desc"
                className="h-auto w-full min-w-[900px]"
              >
                <title id="erd-title">Entity relationship diagram</title>
                <desc id="erd-desc">
                  Vehicles relate to bookings and blockouts; bookings relate to customers and payments; users relate to audit logs and admin utilities.
                </desc>
                <defs>
                  <marker
                    id="arrow-erd"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox x={60} y={60} width={240} height={78} title="users" lines={["Admin accounts"]} />
                <SvgBox x={60} y={160} width={240} height={78} title="admin_login_attempts" lines={["Rate-limit + lockouts"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={60} y={260} width={240} height={78} title="audit_logs" lines={["Key actions + trails"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={60} y={360} width={240} height={78} title="user_invites" lines={["Invitations + onboarding"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={360} y={360} width={240} height={78} title="admin_documents" lines={["Docs notes storage"]} />

                <SvgBox x={360} y={80} width={240} height={78} title="vehicles" lines={["Fleet inventory"]} />
                <SvgBox x={360} y={190} width={240} height={78} title="blockouts" lines={["Vehicle unavailable windows"]} fill="var(--ccr-surface-soft)" />

                <SvgBox x={650} y={80} width={250} height={78} title="bookings" lines={["Dates + status + pricing"]} />
                <SvgBox x={650} y={190} width={250} height={78} title="customers" lines={["Name + contact info"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={650} y={300} width={250} height={78} title="payments" lines={["Deposits + balance records"]} />
                <SvgBox x={650} y={410} width={250} height={78} title="webhook_events" lines={["Idempotency gate"]} fill="var(--ccr-surface-soft)" />

                <SvgArrow d="M300 99 L360 99" markerId="arrow-erd" label="updated_by" labelX={308} labelY={88} dashed />
                <SvgArrow d="M180 138 L180 160" markerId="arrow-erd" />
                <SvgArrow d="M180 238 L180 260" markerId="arrow-erd" />
                <SvgArrow d="M180 338 L180 360" markerId="arrow-erd" />

                <SvgArrow d="M600 119 L650 119" markerId="arrow-erd" label="1:N" labelX={612} labelY={108} />
                <SvgArrow d="M480 158 L480 190" markerId="arrow-erd" label="1:N" labelX={492} labelY={178} />
                <SvgArrow d="M775 158 L775 190" markerId="arrow-erd" label="N:1" labelX={786} labelY={178} dashed />
                <SvgArrow d="M775 158 L775 300" markerId="arrow-erd" label="1:N" labelX={786} labelY={246} />
                <SvgArrow d="M775 378 L775 410" markerId="arrow-erd" dashed label="de-dupe" labelX={786} labelY={402} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Hosting & Server Environment",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Netlify:</span> Branch pushes build through
                <code>@netlify/plugin-nextjs</code>; staging runs bootstrap + migrations, while production runs
                migrations before <code>npm run build</code> (see <code>netlify.toml</code>).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Database:</span> Neon Postgres; requires{" "}
                <code>DATABASE_URL</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">SSL & domain:</span> Managed by Netlify/your DNS
                provider; set <code>SITE_URL</code> to the public https URL.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Cron:</span> Scheduled functions exist for pickup
                and balance reminders, note emails, maintenance reminders, and archived-file cleanup; routes are also callable
                manually via <code>/admin/cron</code>.
              </li>
            </ul>
            <details className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Environment variables (high level)
              </summary>
              <CodeBlock>{`Core
- DATABASE_URL
- ADMIN_SESSION_SECRET
- CSRF_SECRET
- SITE_URL

Payments (choose the configured provider)
- PAYMENT_PROVIDER (wipay|stripe)

Stripe staging / production
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_TEST_MODE (true with sk_test_ in staging; false with sk_live_ in production)

WiPay production
- SITE_URL (builds WiPay response_url)
- WIPAY_ACCOUNT_NUMBER
- WIPAY_API_KEY
- WIPAY_ENV (sandbox|live)
- WIPAY_FEE_STRUCTURE (customer_pay|merchant_absorb|split)
- WIPAY_COUNTRY_CODE (optional; current site uses JM/JMD)
- WIPAY_ORIGIN (optional; defaults to curated-car-rentals)

Email (Resend)
- RESEND_API_KEY
- RESEND_FROM

	Invoices
	- PDF_PROVIDER (gotenberg|pdfmonkey)
	- GOTENBERG_URL (required in production when PDF_PROVIDER=gotenberg)
	- PDFMONKEY_API_KEY (required when PDF_PROVIDER=pdfmonkey)
	- PDFMONKEY_TEMPLATE_ID (required when PDF_PROVIDER=pdfmonkey)

Uploads (Bunny Storage)
- FILE_STORAGE_PROVIDER=bunny
- BUNNY_STORAGE_ENDPOINT (regional API origin; production currently uses New York)
- BUNNY_STORAGE_PUBLIC_ZONE
- BUNNY_STORAGE_PUBLIC_ACCESS_KEY (server-only secret)
- BUNNY_PUBLIC_CDN_URL (the public Pull Zone HTTPS origin)
- BUNNY_STORAGE_PRIVATE_ZONE
- BUNNY_STORAGE_PRIVATE_ACCESS_KEY (server-only secret)

Legacy Uploadcare (retain until historical assets are migrated)
- NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY
- UPLOADCARE_SECRET_KEY

Cron
- CRON_SECRET`}</CodeBlock>
            </details>
            <details className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Local real-testing reset
              </summary>
              <div className="mt-3 space-y-3 text-sm text-[var(--ccr-muted)]">
                <p>
                  Use <code>npm run customer:reset</code> only from the local workspace when you need a clean
                  customer-aligned testing baseline. The reset keeps admin users, customer profiles, and
                  settings, but clears business-history/demo data and reboots the public fleet + booking
                  locations from the current customer-site setup.
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    Current source of truth for the reboot: the live customer fleet and the four live booking
                    locations.
                  </li>
                  <li>
                    Vehicle publishing workflow: new vehicles start private and must be explicitly switched to
                    public before they appear on the fleet page or public booking flow.
                  </li>
                  <li>
                    Vehicle gallery ownership: customer fleet images and future vehicle-gallery uploads should
                    be written to the configured Bunny public zone using the vehicle gallery naming convention.
                    Existing Uploadcare images remain readable until migration is complete.
                  </li>
                  <li>
                    Phase two: stricter blocking of E2E/demo seed scripts against this environment is planned,
                    but not enforced in this phase.
                  </li>
                </ul>
              </div>
            </details>
          </>
        ),
      },
      {
        title: "Production Go-Live Checklist",
        content: (
          <>
            <p className="text-sm text-[var(--ccr-muted)]">
              Use this checklist before switching from test/sandbox to production.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Git + release:</span> Push the candidate to
                <code> staging</code>, verify the Netlify staging deployment and smoke tests, then promote that verified
                commit to <code>main</code>. Tag a release after the production deployment is healthy; do not deploy from
                an unpushed local workspace.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Netlify config:</span> Confirm production site is linked
                to the correct repository/branch, build command is <code>npm run build</code>, and env vars are set in the
                production context.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Domain + HTTPS:</span> DNS points to Netlify, TLS is
                active, and <code>SITE_URL</code> is the live https URL (not localhost).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Database:</span> Production <code>DATABASE_URL</code> is
                set, required migrations are applied, and a restore-tested backup/snapshot exists.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Payments:</span> Staging must use Stripe test
                credentials (<code>STRIPE_TEST_MODE=true</code> with an <code>sk_test_</code> key). For production, validate
                the selected <code>PAYMENT_PROVIDER</code>: Stripe requires <code>STRIPE_TEST_MODE=false</code>, an
                <code>sk_live_</code> key, and a verified webhook; WiPay requires live credentials,
                <code>WIPAY_ENV=live</code>, and the approved fee structure. Run a small real payment plus webhook
                reconciliation only after the provider configuration is confirmed.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Email (Resend):</span> Validate <code>RESEND_API_KEY</code>{" "}
                and <code>RESEND_FROM</code> on the production domain, then verify booking/contact/admin emails deliver.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Invoices:</span> If using Gotenberg, set{" "}
                <code>PDF_PROVIDER=gotenberg</code> and <code>GOTENBERG_URL</code>; if using PDFMonkey, set{" "}
                <code>PDF_PROVIDER=pdfmonkey</code>, <code>PDFMONKEY_API_KEY</code>, and{" "}
                <code>PDFMONKEY_TEMPLATE_ID</code>. Then generate and open a real invoice from an actual booking.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Bunny Storage:</span> Confirm
                <code>FILE_STORAGE_PROVIDER=bunny</code>, separate production public/private zones, server-only access
                keys, the public Pull Zone HTTPS origin, and that the private zone has no public Pull Zone. Upload a
                public image and a private ID image through CCR before considering Uploadcare retirement.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Security:</span> Strong production values for{" "}
                <code>ADMIN_SESSION_SECRET</code>, <code>CSRF_SECRET</code>, and <code>CRON_SECRET</code>; confirm least-privilege
                admin users and rotate any exposed secrets.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Scheduled jobs:</span> Confirm Netlify scheduled
                functions run and validate pickup/balance/note/maintenance/archive cleanup jobs in <code>/admin/cron</code>{" "}
                and logs.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Operational smoke test:</span> Run end-to-end flow
                (book
                <DateRangeArrow />
                pay deposit
                <DateRangeArrow />
                success page
                <DateRangeArrow />
                admin booking/payment state
                <DateRangeArrow />
                reminder preview
                <DateRangeArrow />
                invoice/email checks).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Rollback plan:</span> Document who can roll back,
                previous deploy target, and how to restore DB snapshots if needed.
              </li>
            </ol>
            <details className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Go-live command gate
              </summary>
              <CodeBlock>{`Run these before and after production deploy:
- npm test
- npx tsc --noEmit
- npm run build
- E2E_BASE_URL=https://your-production-domain npm run test:e2e (or staging equivalent)`}</CodeBlock>
            </details>
          </>
        ),
      },
      {
        title: "Developer Workflow & Code Documentation",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <code>npm run dev</code>
                <DateRangeArrow />
                local development at <code>http://localhost:3000</code>
              </li>
              <li>
                <code>npm run build</code>
                <DateRangeArrow />
                production build + type checking
              </li>
              <li>
                <code>npm run lint</code>
                <DateRangeArrow />
                ESLint
              </li>
            </ul>
            <p>
              Key folders:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li><code>src/app</code> — routes (public, admin, API)</li>
              <li><code>src/components</code> — UI components (public + admin)</li>
              <li><code>src/lib</code> — server utilities (db, auth, payments, email, health)</li>
              <li><code>db/schema.sql</code> — Postgres schema</li>
            </ul>
            <p>
              Version control: keep changes small, prefer PRs with a clear description, and rely on Git history for a
              canonical change log alongside the “Notes & Change Log” panel on <code>/admin/documentation</code>.
            </p>
          </>
        ),
      },
    ],
  },
  integrations: {
    title: "Integrations & Documents",
    description:
      "Operational reference for payment modes, PDF provider setup, template previews, and email attachment behavior.",
    blocks: [
      {
        title: "Payment Integration Matrix",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Configured checkout:</span>{" "}
                <code>POST /api/payments/start</code> selects the configured provider.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Staging:</span> Stripe test mode is required;
                configure <code>STRIPE_TEST_MODE=true</code> with test credentials and validate the Stripe webhook.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Production:</span> Use the provider named by
                <code> PAYMENT_PROVIDER</code>. Stripe requires live-mode credentials and a signing secret; WiPay uses
                its live account/API credentials and configured fee structure.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">WiPay-specific routes:</span>{" "}
                <code>/api/payments/wipay/*</code> support WiPay deposit, balance, full, and custom flows when WiPay is
                the selected provider.
              </li>
              <li>
                Reconciliation is provider-specific: WiPay uses <code>/api/payments/wipay/return</code> and
                <code> /api/payments/wipay/webhook</code>; Stripe uses <code>/api/payments/stripe/return</code> and
                <code> /api/payments/stripe/webhook</code>. Register the matching webhook with the provider and never
                place signing secrets in browser-accessible variables.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Invoice / Quote / Agreement Pipeline",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Invoice PDFs:</span> provider-backed via{" "}
                <code>PDF_PROVIDER</code> with runtime support for <code>gotenberg</code> and <code>pdfmonkey</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Quote PDFs:</span> generated natively via{" "}
                <code>/api/admin/quotes/[id]/pdf</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Rental agreement:</span> generated from booking data
                and includes booking signature when available.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Template preview lab:</span>{" "}
                <code>/admin/template-lab</code> supports invoice, quote, agreement, and receipt preview routes.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Email Attachment Behavior",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Booking lifecycle emails can include invoice and rental agreement documents depending on the trigger.
              </li>
              <li>
                Quote emails include quote PDF attachments generated at send time.
              </li>
              <li>
                If signature media is missing/unreadable, rental agreement rendering falls back gracefully (signature block
                remains with timestamp text where available).
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Scheduled Data Retention Jobs",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <code>POST /api/cron/archive-file-cleanup</code> permanently deletes archived vehicle documents older than 30
                days.
              </li>
              <li>
                Triggered by Netlify scheduled function <code>cron-archive-file-cleanup</code> (daily schedule in{" "}
                <code>netlify.toml</code>).
              </li>
              <li>
                Existing reminder jobs remain active: pickup, balance, note emails, and maintenance reminders.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  security: {
    title: "Security",
    description:
      "Consolidated security guidance for access control, authentication, webhook verification, auditability, and operational hardening.",
    blocks: [
      {
        title: "Security Overview",
        content: (
          <>
            <p>
              Security responsibilities in this system are split across the public site, the admin portal,
              third-party providers, and scheduled jobs. The public experience accepts customer details and
              starts hosted checkout, while the admin portal exposes higher-risk actions such as booking edits,
              payments, users, reports, cron runs, and document access.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Public surface:</span> fleet browsing,
                pricing/quote requests, booking creation, and hosted payment handoff.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Admin-only surface:</span> authenticated
                routes under <code>/admin</code>, manual payment actions, cron execution, document generation,
                and user management.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Third-party trust boundaries:</span>{" "}
                WiPay handles card entry, Resend handles outbound email, configurable PDF providers render
                invoices/documents, Bunny Storage handles current uploads, and Uploadcare remains a legacy read fallback
                until migration is complete.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Operational principle:</span> use the
                smallest privileges needed, record sensitive actions, and verify provider callbacks before
                changing booking/payment state.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Access & Roles",
        content: (
          <>
            <p>
              Roles are stored in <code>users.role</code> and gate access to admin features. Any action that
              changes bookings, payments, users, cron behavior, or system configuration should be treated as
              admin-only unless there is explicit product intent otherwise.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Least privilege:</span> only grant admin
                access to staff who need operational controls; avoid shared admin accounts.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Developer-only surfaces:</span>{" "}
                documentation, template-lab, and higher-risk tooling should remain restricted to the intended
                internal roles.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Admin-only actions:</span> user invites,
                status changes, payment reconciliation, promo management, cron runs, and health/deployment
                checks should stay behind authenticated role checks.
              </li>
              <li>
                Review the operational role summary in{" "}
                <Link href="/admin/documentation/operations" className="font-semibold text-[var(--ccr-text)] underline">
                  Operational &amp; User Documentation
                </Link>
                , but keep security-sensitive role decisions anchored here.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Authentication & Session Security",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Identity and roles:</span> Clerk may establish
                identity, but local <code>users.role</code> remains the authorization source of truth. Legacy password
                hashes must never be logged or exported while the cookie-login path remains available.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Sessions:</span> admin authentication uses
                signed session cookies; session secrets must be strong and rotated if exposed.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Login protection:</span> use lockouts and
                rate-limited login attempts to reduce brute-force risk.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">CSRF:</span> state-changing requests
                require CSRF protection via the bootstrap token flow at <code>/api/security/csrf</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Environment secrets:</span>{" "}
                <code>ADMIN_SESSION_SECRET</code> and <code>CSRF_SECRET</code> should be unique per environment
                and never reused across unrelated deployments.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Payments, Webhooks & Cron Verification",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Hosted checkout boundary:</span> the configured
                payment provider (Stripe or WiPay) handles card entry, which reduces PCI scope; this app should only store
                transaction references and reconciliation metadata.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Webhook safety:</span> payment webhooks
                must be validated and processed idempotently so duplicate provider events do not create duplicate
                payments.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Return vs webhook:</span> redirects improve
                UX, but provider webhook reconciliation remains the stronger system-of-record signal.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Cron protection:</span> cron routes
                require <code>x-cron-secret</code>; do not expose or reuse <code>CRON_SECRET</code> in client-side
                code or public config.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Simulation boundaries:</span> admin cron
                simulation is for validation and observability, not for bypassing provider verification or sending
                uncontrolled live traffic.
              </li>
            </ul>
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">
              The underlying endpoint inventory remains in{" "}
              <Link href="/admin/documentation/technical" className="font-semibold text-[var(--ccr-text)] underline">
                Technical Documentation
              </Link>
              .
            </p>
          </>
        ),
      },
      {
        title: "Data Handling, Files & Auditability",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Customer data:</span> booking/contact
                fields, payment metadata, and reminders should be treated as operationally sensitive even when not
                regulated as card data.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Documents & uploads:</span> invoices,
                rental agreements, signatures, and uploaded files should only be exposed through authorized admin
                flows and provider configurations that match the intended retention/access policy.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Audit logs:</span> user/system actions,
                webhook events, and other admin traces should remain available for investigation and operational
                accountability.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Retention-sensitive areas:</span> archived
                files, generated documents, provider logs, and exported operational data should follow documented
                cleanup and access rules.
              </li>
              <li>
                See{" "}
                <Link href="/admin/documentation/legal" className="font-semibold text-[var(--ccr-text)] underline">
                  Legal &amp; Compliance
                </Link>
                {" "}for privacy/cookie/compliance framing, and keep implementation controls here.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Operational Security Checklist",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Use strong unique secrets for admin session, CSRF, cron, payments, and email providers.</li>
              <li>Rotate secrets immediately if they are exposed in logs, screenshots, preview configs, or shared docs.</li>
              <li>Confirm least-privilege admin access before go-live and after staffing changes.</li>
              <li>Validate health/readiness checks before releases and after provider/config changes.</li>
              <li>Smoke-test booking creation, payment return/webhook reconciliation, admin login, and reminder flows after deploys.</li>
              <li>Review cron outcomes and audit logs regularly for failed sends, unexpected manual actions, or replayed provider traffic.</li>
              <li>Document who owns incident response, rollback authority, and provider escalation paths.</li>
            </ul>
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">
              Use this together with the production checklist in{" "}
              <Link href="/admin/documentation/technical" className="font-semibold text-[var(--ccr-text)] underline">
                Technical Documentation
              </Link>
              {" "}and the day-to-day runbooks in{" "}
              <Link href="/admin/documentation/operations" className="font-semibold text-[var(--ccr-text)] underline">
                Operational &amp; User Documentation
              </Link>
              .
            </p>
          </>
        ),
      },
    ],
  },
  operations: {
    title: "Operational & User Documentation",
    description:
      "Runbooks for day-to-day usage: content updates, roles, maintenance, support, and troubleshooting. See Security for access control and operational safety guidance.",
    blocks: [
      {
        title: "Booking Lifecycle Diagram",
        content: (
          <>
            <DiagramFrame
              title="Booking lifecycle + reminders"
              description="States the booking can move through, plus where reminders fit."
              fallbackText={BOOKING_LIFECYCLE_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 420"
                role="img"
                aria-labelledby="booking-life-title booking-life-desc"
                className="h-auto w-full min-w-[900px]"
              >
                <title id="booking-life-title">Booking lifecycle and reminders</title>
                <desc id="booking-life-desc">
                  Booking statuses progress from pending payment to confirmed, picked up, returned; cancellations can occur; cron reminders send pickup and balance due reminders.
                </desc>
                <defs>
                  <marker
                    id="arrow-booking-life"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox x={70} y={70} width={200} height={84} title="PENDING_PAYMENT" lines={["Booking created", "Deposit due now"]} />
                <SvgBox x={300} y={70} width={200} height={84} title="CONFIRMED" lines={["Deposit paid", "Ready for pickup"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={530} y={70} width={200} height={84} title="PICKED_UP" lines={["Customer has vehicle", "Balance may remain"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={760} y={70} width={160} height={84} title="RETURNED" lines={["Rental completed"]} />

                <SvgArrow d="M270 112 L300 112" markerId="arrow-booking-life" />
                <SvgArrow d="M500 112 L530 112" markerId="arrow-booking-life" />
                <SvgArrow d="M730 112 L760 112" markerId="arrow-booking-life" />

                <SvgBox
                  x={300}
                  y={200}
                  width={200}
                  height={76}
                  title="CANCELLED"
                  lines={["By admin or customer"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.12}
                  stroke="var(--ccr-accent-strong)"
                />
                <SvgArrow d="M170 154 L170 206 L300 206" markerId="arrow-booking-life" dashed label="cancel" labelX={188} labelY={196} />
                <SvgArrow d="M400 154 L400 200" markerId="arrow-booking-life" dashed />

                <SvgBox x={70} y={300} width={260} height={84} title="Cron: Pickup reminders" lines={["POST /api/cron/pickup-reminders", "T-1 day before start_date"]} fill="var(--ccr-surface)" />
                <SvgBox x={360} y={300} width={300} height={84} title="Cron: Balance reminders" lines={["POST /api/cron/balance-reminders", "On/after start_date while due"]} fill="var(--ccr-surface)" />

                <SvgArrow d="M200 300 L200 260 L300 260" markerId="arrow-booking-life" label="email" labelX={214} labelY={276} />
                <SvgArrow d="M510 300 L510 260 L530 260" markerId="arrow-booking-life" label="email" labelX={524} labelY={276} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Content Management Guide",
        content: (
          <>
            <p>
              Content is managed in two primary ways: (1) code-based marketing content and (2) admin-managed operational data.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Marketing content (code):</span> Update copy and
                template data in <code>src/data</code> (e.g., <code>content.ts</code>, <code>services.ts</code>,{" "}
                <code>vehicles.ts</code>) and images under <code>public/</code>.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Fleet inventory (DB/admin):</span> Use{" "}
                <code>/admin/vehicles</code> to manage production vehicles if DB-backed fleet is enabled.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Documentation notes:</span> Use{" "}
                <code>/admin/documentation</code> Notes editor for quick updates.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "User Roles & Capabilities",
        content: (
          <>
            <p>
              Roles are stored in <code>users.role</code>; Clerk identity can be linked, but it is not the authorization
              source of truth. Login supports the configured Clerk or legacy path during the cutover.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">ADMIN:</span> Privileged operational access,
                including payments, users, settings, media, reporting, and fleet administration.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">OPERATIONS:</span> Day-to-day operational access
                for bookings, quotes, customers, and calendar workflows without privileged or developer-only tooling.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">DEVELOPER:</span> Admin capabilities plus
                developer-only diagnostic and configuration surfaces, including health, cron diagnostics, documentation,
                template tools, and <code>/admin/developer</code>. Assign only to trusted technical staff.
              </li>
            </ul>
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">
              For least-privilege guidance, admin-only action boundaries, session security, and secrets handling,
              see{" "}
              <Link href="/admin/documentation/security" className="font-semibold text-[var(--ccr-text)] underline">
                Security
              </Link>
              .
            </p>
          </>
        ),
      },
      {
        title: "Maintenance & Support Plan",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Backups:</span> Use Neon’s backup / point-in-time
                recovery options for Postgres data.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Secret rotation:</span> Rotate{" "}
                <code>ADMIN_SESSION_SECRET</code> and <code>CSRF_SECRET</code> on a schedule; rotate third-party keys if
                compromised.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Monitoring:</span> Check <code>/admin/health</code>{" "}
                regularly; use Netlify logs for runtime errors and validate cron outcomes from the{" "}
                <code>/admin/cron</code> Last Runs/Recent Reminder Events panels.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Updates:</span> Keep dependencies updated; validate
                critical flows (booking creation, payment start/return, admin login) after deployments.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Troubleshooting Guide",
        content: (
          <>
            <p className="text-[var(--ccr-text)] font-semibold">First stop: <code>/admin/health</code></p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">DB errors:</span> Verify <code>DATABASE_URL</code>{" "}
                and that <code>db/schema.sql</code> has been applied.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">CSRF errors (403):</span> Ensure the CSRF bootstrap
                runs and requests include the <code>x-csrf-token</code> header for protected endpoints.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Payment start fails:</span> Confirm
                <code>PAYMENT_PROVIDER</code> and the matching credentials. Staging requires Stripe test mode; production
                Stripe requires live mode, while WiPay requires valid account-number formatting and provider reachability.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">File storage fails:</span> Check
                <code>/admin/health</code> for the active provider, then verify the Bunny public/private zone credentials,
                public Pull Zone URL, and Netlify deploy context. Never use a private-zone access key in browser code.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Emails not sending:</span> Validate Resend keys and{" "}
                sender settings; check logs for provider failures.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Invoices failing:</span> Verify the configured{" "}
                <code>PDF_PROVIDER</code> path (<code>GOTENBERG_URL</code> for gotenberg or PDFMonkey credentials/template),
                and check provider/network health.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Cron reminders:</span> Validate <code>CRON_SECRET</code>{" "}
                and Netlify scheduled functions; use <code>/admin/cron</code> manual run buttons or the simulate button
                to verify both Last Runs and Recent Reminder Events update.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  legal: {
    title: "Legal & Compliance",
    description:
      "Policy templates and compliance notes. Review with qualified counsel before publishing. See Security for implementation-side controls and verification patterns.",
    blocks: [
      {
        title: "Data Processing Diagram",
        content: (
          <>
            <DiagramFrame
              title="Data processing map (high level)"
              description="What data goes where (hosted checkout reduces PCI scope). Review with counsel."
              fallbackText={DATA_PROCESSING_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 460"
                role="img"
                aria-labelledby="data-map-title data-map-desc"
                className="h-auto w-full min-w-[900px]"
              >
                <title id="data-map-title">Data processing map</title>
                <desc id="data-map-desc">
                  Customer data and bookings stored in Postgres; payments handled by WiPay; emails via Resend; invoice PDFs via configurable provider; public and private uploads via Bunny Storage; cron jobs via Netlify.
                </desc>
                <defs>
                  <marker
                    id="arrow-data-map"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox x={60} y={70} width={250} height={92} title="Customer" lines={["Name/email/phone", "Dates + pickup location"]} />
                <SvgBox x={355} y={55} width={250} height={122} title="Next.js App" lines={["Public + Admin", "API routes"]} fill="var(--ccr-surface-soft)" />

                <SvgBox x={650} y={70} width={250} height={92} title="Neon Postgres" lines={["bookings, customers,", "payments metadata"]} />
                <SvgBox
                  x={650}
                  y={190}
                  width={250}
                  height={84}
                  title="WiPay"
                  lines={["Hosted checkout", "No card storage"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.14}
                  stroke="var(--ccr-accent-strong)"
                />
                <SvgBox x={650} y={290} width={250} height={84} title="Resend" lines={["Email notifications"]} />
                <SvgBox x={60} y={290} width={250} height={84} title="PDF Provider" lines={["Gotenberg/PDFMonkey", "Invoice PDFs"]} />
                <SvgBox x={60} y={190} width={250} height={84} title="Bunny Storage" lines={["Public CDN + private zone"]} />
                <SvgBox x={355} y={290} width={250} height={84} title="Netlify Cron" lines={["Scheduled reminders", "/api/cron/*"]} />

                <SvgArrow d="M310 116 L355 116" markerId="arrow-data-map" label="submit" labelX={318} labelY={104} />
                <SvgArrow d="M605 116 L650 116" markerId="arrow-data-map" label="store" labelX={614} labelY={104} />
                <SvgArrow d="M605 170 L650 210" markerId="arrow-data-map" dashed label="deposit checkout" labelX={548} labelY={206} />
                <SvgArrow d="M650 230 L605 170" markerId="arrow-data-map" dashed label="return/webhook" labelX={548} labelY={242} />
                <SvgArrow d="M605 300 L650 320" markerId="arrow-data-map" label="send" labelX={616} labelY={306} />
                <SvgArrow d="M355 170 L310 210" markerId="arrow-data-map" dashed label="uploads" labelX={310} labelY={186} />
                <SvgArrow d="M355 330 L310 330" markerId="arrow-data-map" dashed label="invoices" labelX={326} labelY={318} />
                <SvgArrow d="M480 290 L480 177" markerId="arrow-data-map" dashed label="triggers" labelX={492} labelY={238} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Privacy Policy (Template Outline)",
        content: (
          <>
            <p>
              This project collects customer contact details and booking metadata. Payments are processed via hosted
              checkout (WiPay), which reduces PCI scope.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Data collected: name, email, phone, booking dates, pickup location, vehicle selection.</li>
              <li>Payment data: store transaction references and reconciliation metadata; do not store raw card data.</li>
              <li>Processors: WiPay (payments), Resend (email), configurable PDF provider (Gotenberg/PDFMonkey), and Bunny Storage (public and private uploads). Uploadcare remains a legacy processor only while historical assets are retained there.</li>
              <li>Retention: define retention windows for bookings, payments, and logs.</li>
              <li>User rights: provide contact method for access/deletion requests where applicable.</li>
            </ul>
          </>
        ),
      },
      {
        title: "Terms & Conditions (Template Outline)",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Rental eligibility requirements (license, age, etc.).</li>
              <li>Deposit policy: “due now” online deposit; remaining balance “due on pickup”.</li>
              <li>Cancellation and refund policy (manual refunds may apply).</li>
              <li>Vehicle condition, damage responsibility, late returns, and fees.</li>
              <li>Liability limitations and dispute resolution.</li>
            </ul>
          </>
        ),
      },
      {
        title: "Cookie Policy",
        content: (
          <>
            <p>
              Cookies are used to support admin authentication and security protections.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li><span className="font-semibold text-[var(--ccr-text)]">Admin session cookie:</span> HttpOnly cookie used to keep admins signed in.</li>
              <li><span className="font-semibold text-[var(--ccr-text)]">CSRF token:</span> Used to protect state-changing requests.</li>
              <li>If analytics are added later, document tracking cookies and provide consent controls as required.</li>
            </ul>
          </>
        ),
      },
      {
        title: "Compliance Notes",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">PCI:</span> Hosted checkout reduces PCI scope, but
                security best practices still apply (TLS, least privilege, log hygiene).
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Security:</span> Follow OWASP guidance for sessions,
                password storage, and rate limiting.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Data protection:</span> Define incident response and
                access controls for admin accounts.
              </li>
            </ul>
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">
              This section covers policy/compliance framing. For the application-level controls behind sessions,
              webhook verification, cron protection, and auditability, see{" "}
              <Link href="/admin/documentation/security" className="font-semibold text-[var(--ccr-text)] underline">
                Security
              </Link>
              .
            </p>
          </>
        ),
      },
    ],
  },
  "project-management": {
    title: "Project Management",
    description:
      "Planning and governance templates: milestones, budget, and change logging.",
    blocks: [
      {
        title: "Timeline Diagram",
        content: (
          <>
            <DiagramFrame
              title="Delivery timeline"
              description="A template sequence for planning and stakeholder alignment."
              fallbackText={PROJECT_TIMELINE_DIAGRAM}
            >
              <svg
                viewBox="0 0 960 260"
                role="img"
                aria-labelledby="pm-timeline-title pm-timeline-desc"
                className="h-auto w-full min-w-[900px]"
              >
                <title id="pm-timeline-title">Project delivery timeline</title>
                <desc id="pm-timeline-desc">
                  Sequence from discovery and PRD through design, build, integrations, UAT, go-live, and monitoring.
                </desc>
                <defs>
                  <marker
                    id="arrow-pm-timeline"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ccr-muted)" />
                  </marker>
                </defs>

                <SvgBox x={50} y={70} width={140} height={78} title="Discovery" lines={["PRD sign-off"]} />
                <SvgBox x={210} y={70} width={140} height={78} title="Design" lines={["IA + mockups"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={370} y={70} width={140} height={78} title="Build" lines={["UI + API"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={530} y={70} width={140} height={78} title="Integrate" lines={["Payments/email"]} fill="var(--ccr-surface-soft)" />
                <SvgBox x={690} y={70} width={110} height={78} title="UAT" lines={["Staging"]} />
                <SvgBox
                  x={820}
                  y={70}
                  width={90}
                  height={78}
                  title="Go-live"
                  lines={["Launch"]}
                  fill="var(--ccr-accent)"
                  fillOpacity={0.14}
                  stroke="var(--ccr-accent-strong)"
                />

                <SvgArrow d="M190 110 L210 110" markerId="arrow-pm-timeline" />
                <SvgArrow d="M350 110 L370 110" markerId="arrow-pm-timeline" />
                <SvgArrow d="M510 110 L530 110" markerId="arrow-pm-timeline" />
                <SvgArrow d="M670 110 L690 110" markerId="arrow-pm-timeline" />
                <SvgArrow d="M800 110 L820 110" markerId="arrow-pm-timeline" />

                <SvgBox x={370} y={170} width={300} height={70} title="Monitoring window" lines={["Track KPIs", "Use /admin/health readiness gate"]} />
                <SvgArrow d="M865 148 L865 170" markerId="arrow-pm-timeline" dashed label="after launch" labelX={782} labelY={164} />
              </svg>
            </DiagramFrame>
          </>
        ),
      },
      {
        title: "Timeline & Milestones (Template)",
        content: (
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>Discovery & PRD sign-off</li>
              <li>
                Design: wireframes
                <DateRangeArrow />
                mockups
                <DateRangeArrow />
                approval
              </li>
              <li>Frontend build: public pages + admin UI</li>
              <li>Integrations: payments, email, invoices, uploads</li>
              <li>Testing: staging, UAT, go-live checklist</li>
              <li>Go-live + monitoring window</li>
            </ul>
            <p>
              Use <code>/admin/health</code> as the operational “readiness gate”.
            </p>
          </>
        ),
      },
      {
        title: "Budget & Resource Allocation (Template)",
        content: (
          <>
            <p>Define owners and budgets per workstream:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Product/PM: requirements, stakeholder reviews</li>
              <li>Design: IA, wireframes, UI, accessibility</li>
              <li>Engineering: frontend, backend/API, integrations</li>
              <li>Ops: customer support, fleet operations, content updates</li>
              <li>Tools: hosting, database, email, payments, PDFs, uploads</li>
            </ul>
          </>
        ),
      },
      {
        title: "Change Log",
        content: (
          <>
            <p>
              Maintain a lightweight change log in two places:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Git history:</span> the canonical record of code
                changes.
              </li>
              <li>
                <span className="font-semibold text-[var(--ccr-text)]">Documentation notes:</span> high-level release notes
                and operational changes (see <code>/admin/documentation</code>).
              </li>
            </ul>
            <details className="mt-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ccr-text)]">
                Suggested change log format
              </summary>
              <CodeBlock>{`Date: YYYY-MM-DD
Owner: <name/email>
Type: Feature | Fix | Ops | Security
Summary: <1-2 sentences>
Impact: <who/what changed>
Rollout: <steps or "none">
Backout: <steps or "revert">`}</CodeBlock>
            </details>
          </>
        ),
      },
    ],
  },
};

export default async function AdminDocumentationSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const access = await resolveAdminActor({ requirement: "developer" });
  if (!access.ok) {
    notFound();
  }

  const { section } = await params;
  const doc = DOCS[section];
  const docMeta = getDocumentationSectionMeta(section);
  if (!doc || !docMeta) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">{docMeta.label}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ccr-muted)]">{docMeta.description}</p>
        </div>
        <Link
          href="/admin/documentation"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
        >
          Back to documentation
        </Link>
      </div>

      <div className="mt-6 space-y-6 text-sm text-[var(--ccr-text)]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <h2 className="text-lg font-bold text-[var(--ccr-text)]">Browse documentation</h2>
              <p className="mt-2 text-[var(--ccr-muted)]">
                Jump across the full documentation area without going back to the home page.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {DOCUMENTATION_SECTION_LINKS.map((sectionLink) => {
                  const isActive = sectionLink.href === `/admin/documentation/${section}`;
                  return (
                    <Link
                      key={sectionLink.href}
                      href={sectionLink.href}
                      className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                        isActive
                          ? "border-[var(--ccr-accent-strong)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]"
                      }`}
                    >
                      {sectionLink.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--ccr-text)]">In this section</h2>
              <p className="mt-2 text-[var(--ccr-muted)]">
                Use these anchors to jump straight to a topic on this page.
              </p>
              <div className="mt-4 space-y-2">
                {docMeta.blocks.map((block) => (
                  <Link
                    key={block.id}
                    href={`#${block.id}`}
                    className="block rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-bg)]"
                  >
                    <span>{block.title}</span>
                    <p className="mt-1 text-xs font-normal text-[var(--ccr-muted)]">{block.summary}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {doc.blocks.map((block) => {
          const blockMeta = getDocumentationBlockMeta(section, block.title);
          return (
            <Card
              key={block.title}
              id={blockMeta?.id ?? toDocumentationAnchorId(block.title)}
              title={block.title}
            >
              {block.content}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

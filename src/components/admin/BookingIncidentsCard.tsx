import Link from "next/link";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import type { BookingIncidentSummary } from "@/lib/bookings/bookingIncidents";

type BookingIncidentsCardProps = {
  incidents: BookingIncidentSummary[];
};

function severityBadgeClass(severity: BookingIncidentSummary["severity"]) {
  if (severity === "critical") {
    return "border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }

  return "border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function severityLabel(severity: BookingIncidentSummary["severity"]) {
  if (severity === "critical") return "Critical";
  return "Warning";
}

export function BookingIncidentsCard({ incidents }: BookingIncidentsCardProps) {
  if (incidents.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Booking incidents</h2>
        <p className="mt-1 text-sm text-[var(--ccr-muted)]">
          Important booking-linked issues are surfaced here for quick review.
        </p>
      </div>

      <div className="mt-4 divide-y divide-[var(--ccr-border)]">
        {incidents.map((incident) => (
          <div
            key={incident.id}
            className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${severityBadgeClass(
                    incident.severity,
                  )}`}
                >
                  {severityLabel(incident.severity)}
                </span>
                <h3 className="text-sm font-semibold text-[var(--ccr-text)]">{incident.title}</h3>
              </div>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">{incident.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--ccr-muted)]">
                <span className="uppercase tracking-wide">{incident.sourceLabel}</span>
                <span>
                  <DateTimeInline value={incident.occurredAt} />
                </span>
              </div>
            </div>

            {incident.actionHref ? (
              <Link
                href={incident.actionHref}
                className="shrink-0 text-sm font-semibold text-[var(--ccr-accent)] transition-colors hover:text-[var(--ccr-text)]"
              >
                View in Messages
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

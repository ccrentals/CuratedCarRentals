import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { BookingIncidentsCard } from "@/components/admin/BookingIncidentsCard";
import {
  BOOKING_INCIDENT_ACTIONS,
  loadBookingIncidents,
  type BookingIncidentSummary,
} from "@/lib/bookings/bookingIncidents";

test("booking incidents loader: queries booking audit incidents and orders by severity then newest", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  const incidents = await loadBookingIncidents(
    "11111111-1111-4111-8111-111111111111",
    async (text, params) => {
      calls.push({ text, params });
      return {
        rowCount: 3,
        rows: [
          {
            id: "fuel-row",
            action: "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED",
            created_at: "2026-03-14T10:00:00.000Z",
            details_json: {
              pickupFuelDisplay: "75%",
              returnFuelDisplay: "50%",
            },
          },
          {
            id: "email-row",
            action: "RESEND_EMAIL_DELIVERY_ISSUE",
            created_at: "2026-03-15T09:00:00.000Z",
            details_json: {
              eventType: "email.failed",
              recipientEmail: "guest@example.com",
              reason: "Mailbox unavailable.",
            },
          },
          {
            id: "damage-row",
            action: "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED",
            created_at: "2026-03-13T08:00:00.000Z",
            details_json: {
              notificationId: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
      };
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? "", /from audit_logs/i);
  assert.match(calls[0]?.text ?? "", /entity_type = 'booking'/i);
  assert.deepEqual(calls[0]?.params, [
    "11111111-1111-4111-8111-111111111111",
    [...BOOKING_INCIDENT_ACTIONS],
  ]);

  assert.deepEqual(
    incidents.map((incident) => incident.type),
    ["INSPECTION_DAMAGE", "EMAIL_DELIVERY_ISSUE", "INSPECTION_FUEL_MISMATCH"],
  );
  assert.equal(incidents[0]?.actionHref, "/admin/messages/22222222-2222-4222-8222-222222222222");
  assert.equal(
    incidents[1]?.summary,
    "Email to guest@example.com failed to deliver. Mailbox unavailable.",
  );
  assert.equal(incidents[2]?.summary, "Return fuel (50%) is below pickup fuel (75%).");
});

test("booking incidents loader: ignores unsupported audit actions", async () => {
  const incidents = await loadBookingIncidents(
    "11111111-1111-4111-8111-111111111111",
    async () => ({
      rowCount: 2,
      rows: [
        {
          id: "ignored-row",
          action: "BOOKING_CANCELLED",
          created_at: "2026-03-15T09:00:00.000Z",
          details_json: {},
        },
        {
          id: "damage-row",
          action: "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED",
          created_at: "2026-03-15T08:00:00.000Z",
          details_json: {},
        },
      ],
    }),
  );

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.type, "INSPECTION_DAMAGE");
});

test("booking incidents card: hides itself when no incidents exist", () => {
  const markup = renderToStaticMarkup(<BookingIncidentsCard incidents={[]} />);
  assert.equal(markup, "");
});

test("booking incidents card: renders severity, source, summary, and message link", () => {
  const incidents: BookingIncidentSummary[] = [
    {
      id: "incident-1",
      bookingId: "11111111-1111-4111-8111-111111111111",
      type: "INSPECTION_DAMAGE",
      severity: "critical",
      title: "Damage reported on return inspection",
      summary: "Return inspection indicates vehicle damage.",
      occurredAt: "2026-03-15T10:30:00.000Z",
      sourceLabel: "Vehicle inspection",
      messageId: "22222222-2222-4222-8222-222222222222",
      actionHref: "/admin/messages/22222222-2222-4222-8222-222222222222",
    },
  ];

  const markup = renderToStaticMarkup(<BookingIncidentsCard incidents={incidents} />);

  assert.match(markup, /Booking incidents/);
  assert.match(markup, /Critical/);
  assert.match(markup, /Damage reported on return inspection/);
  assert.match(markup, /Return inspection indicates vehicle damage/);
  assert.match(markup, /Vehicle inspection/);
  assert.match(markup, /View in Messages/);
  assert.match(markup, /admin\/messages\/22222222-2222-4222-8222-222222222222/);
});

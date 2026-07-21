import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import {
  fetchDashboardBookingSnapshot,
  type DashboardBookingSnapshot,
} from "@/lib/bookings/adminBookingsList";
import { logError } from "@/lib/log";
import {
  fetchActiveFleetSnapshot,
  summarizeActiveFleetSnapshot,
  type ActiveFleetVehicleSnapshot,
} from "@/lib/vehicles/adminFleetSnapshot";

type DashboardRouteDeps = {
  authorize: typeof requireOperationsAccess;
  loadBookings: (now: Date) => Promise<DashboardBookingSnapshot>;
  loadFleet: (now: Date) => Promise<ActiveFleetVehicleSnapshot[]>;
  now: () => Date;
};

const defaultDeps: DashboardRouteDeps = {
  authorize: requireOperationsAccess,
  loadBookings: (now) => fetchDashboardBookingSnapshot({ now }),
  loadFleet: (now) => fetchActiveFleetSnapshot({ now }),
  now: () => new Date(),
};

export async function getNativeAdminDashboard(deps: DashboardRouteDeps = defaultDeps) {
  const auth = await deps.authorize();
  if (!auth.ok) return auth.response;

  try {
    const now = deps.now();
    const [bookingSnapshot, fleetRows] = await Promise.all([
      deps.loadBookings(now),
      deps.loadFleet(now),
    ]);
    const fleet = summarizeActiveFleetSnapshot(fleetRows);

    const response = NextResponse.json({
      ok: true,
      generatedAt: now.toISOString(),
      metrics: {
        totalBookings: bookingSnapshot.counts.totalBookings,
        pendingPayment: bookingSnapshot.counts.pendingPayment,
        confirmedBookings: bookingSnapshot.counts.confirmed,
        totalVehicles: fleet.totalVehicles,
        availableVehicles: fleet.availableVehicles,
        attentionVehicles: fleet.maintenanceVehicles,
      },
      recentBookings: bookingSnapshot.recentBookings.slice(0, 5).map((booking) => ({
        id: booking.id,
        publicId: booking.publicId,
        customerName: booking.customerName,
        vehicleLabel: booking.vehicleLabel,
        startDateIso: booking.startDateIso,
        endDateIso: booking.endDateIso,
        status: booking.status,
        statusLabel: booking.statusLabel,
        substatusIndicators: booking.substatusIndicators,
      })),
      recentVehicles: fleet.recentVehicles.map((vehicle) => ({
        id: vehicle.id,
        publicId: vehicle.public_id,
        label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
        status: vehicle.derived_status,
      })),
      capabilities: {
        role: auth.actor.appRole,
        archiveFallbackActive: bookingSnapshot.archiveNotConfigured,
      },
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch (error) {
    logError("api.admin.dashboard.GET", error, { userId: auth.actor.userId });
    return NextResponse.json({ ok: false, error: "Failed to load the admin dashboard." }, { status: 500 });
  }
}

export async function GET() {
  return getNativeAdminDashboard();
}

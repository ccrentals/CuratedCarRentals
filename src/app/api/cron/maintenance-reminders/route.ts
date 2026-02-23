import { NextResponse } from "next/server";

import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

type DueScheduleRow = {
  schedule_id: string;
  vehicle_id: string;
};

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { settings } = await loadAdminSettings();
    if (!settings.maintenanceRemindersEnabled) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Maintenance reminders are disabled in admin settings.",
      });
    }

    const leadDays = Math.max(1, Math.min(90, settings.maintenanceReminderLeadDays));
    const dueSchedules = await dbQuery<DueScheduleRow>(
      `select s.id as schedule_id, s.vehicle_id
       from vehicle_maintenance_schedules s
       left join vehicle_profiles vp on vp.vehicle_id = s.vehicle_id
       where s.status = 'ACTIVE'
         and (
           (s.next_due_date is not null
            and s.next_due_date >= current_date
            and s.next_due_date <= current_date + ($1::int * interval '1 day'))
           or
           (s.next_due_odometer is not null
            and vp.odometer_value is not null
            and vp.odometer_value >= s.next_due_odometer)
         )`,
      [leadDays],
    );

    let created = 0;
    for (const row of dueSchedules.rows) {
      const insert = await dbQuery<{ id: string }>(
        `insert into maintenance_reminders (vehicle_id, schedule_id, remind_at, status, channel)
         values ($1::uuid, $2::uuid, now(), 'PENDING', 'IN_APP')
         on conflict (schedule_id, channel, date(remind_at)) do nothing
         returning id`,
        [row.vehicle_id, row.schedule_id],
      );
      if (insert.rowCount > 0) created += 1;
    }

    return NextResponse.json({
      ok: true,
      leadDays,
      dueSchedules: dueSchedules.rowCount,
      remindersCreated: created,
      remindersSkipped: dueSchedules.rowCount - created,
      emailMode: "not_configured",
    });
  } catch (error) {
    logError("cron_maintenance_reminders_failed", error, {});
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "42P01") {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to run maintenance reminders." }, { status: 500 });
  }
}


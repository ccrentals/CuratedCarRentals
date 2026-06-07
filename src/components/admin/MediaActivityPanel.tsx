import { DateTimeInline } from "@/components/shared/DateTimeInline";
import type { MediaAuditActivity } from "@/lib/uploads/mediaAudit";

const ACTION_LABELS: Record<MediaAuditActivity["action"], string> = {
  MEDIA_UPLOAD: "Uploaded",
  MEDIA_REMOVE: "Removed",
  MEDIA_PROVIDER_DELETE: "Deleted from Uploadcare",
  MEDIA_SHARED_PRESERVE: "Shared file preserved",
  MEDIA_CLEANUP_FAILED: "Cleanup failed",
  MEDIA_ORPHAN_DELETE: "Orphan deleted",
};

export function MediaActivityPanel({
  activities,
  title = "Media activity",
}: {
  activities: MediaAuditActivity[];
  title?: string;
}) {
  return (
    <section className="mt-4 border-t border-[var(--ccr-border)] pt-4">
      <h3 className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">{title}</h3>
      {activities.length > 0 ? (
        <div className="mt-3 divide-y divide-[var(--ccr-border)]">
          {activities.map((activity) => (
            <div key={activity.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--ccr-text)]">
                  {ACTION_LABELS[activity.action]}
                  {activity.label ? `: ${activity.label}` : ""}
                </p>
                <p className="truncate text-xs text-[var(--ccr-muted)]">
                  {[activity.context, activity.outcome, activity.actorEmail ?? "System"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <DateTimeInline value={activity.createdAt} className="text-xs text-[var(--ccr-muted)]" />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">No media activity recorded yet.</p>
      )}
    </section>
  );
}

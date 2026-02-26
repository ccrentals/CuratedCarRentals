const VEHICLE_EXTENSION_TABLES = new Set([
  "vehicle_profiles",
  "vehicle_documents",
  "vehicle_checklist_items",
  "vehicle_checklist_templates",
  "vehicle_checklist_events",
  "vehicle_notes",
  "vehicle_maintenance_logs",
  "vehicle_maintenance_records",
  "vehicle_maintenance_status_history",
  "vehicle_maintenance_schedules",
  "maintenance_service_types",
  "maintenance_reminders",
  "vehicle_document_links",
  "vehicle_depreciation_profiles",
  "vehicle_depreciation_snapshots",
  "vehicle_availability_rules",
  "vehicle_pricing_rules",
  "blockouts",
]);

export function isVehicleExtensionsMissingTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  if (code !== "42P01") return false;

  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  for (const table of VEHICLE_EXTENSION_TABLES) {
    if (message.includes(table)) return true;
  }
  return false;
}

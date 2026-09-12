import { getDbPool } from "@/lib/db";
import { getVehiclePricingProfile, upsertVehiclePricingRules, deleteVehiclePricingRules, type VehiclePricingRulesPatch } from "./pricingRules";

export class PricingEditConflict extends Error {}
export type PricingEdit = { expectedUpdatedAt?: unknown; userId?: string; dailyRate?: unknown; deposit?: unknown };
const revision = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();

export async function savePricingRules(vehicleId: string, patch: VehiclePricingRulesPatch | null, edit: PricingEdit = {}) {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    await client.query("select id from vehicles where id = $1 for update", [vehicleId]);
    const before = await getVehiclePricingProfile(vehicleId, { client, strictTable: true });
    if (!before) throw new Error("Vehicle not found.");
    if (edit.expectedUpdatedAt === undefined || revision(edit.expectedUpdatedAt) !== revision(before.rules.updatedAt)) {
      throw new PricingEditConflict("Pricing changed since you opened it. Reload pricing and review your changes.");
    }
    if (patch) {
      if (edit.dailyRate !== undefined || edit.deposit !== undefined) {
        if (![edit.dailyRate, edit.deposit].every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647)) throw new Error("Invalid standard rate or deposit.");
        await client.query("update vehicles set daily_rate_cents=$2, deposit_cents=$3, updated_at=now() where id=$1", [vehicleId, edit.dailyRate, edit.deposit]);
      }
      await upsertVehiclePricingRules(vehicleId, patch, { client });
    } else {
      await deleteVehiclePricingRules(vehicleId, { client });
    }
    const after = await getVehiclePricingProfile(vehicleId, { client, strictTable: true });
    await client.query("insert into audit_logs (user_id, action, entity_type, entity_id, details_json) values ($1,$2,'vehicle',$3,$4)",
      [edit.userId ?? null, patch ? "vehicle.pricing.updated" : "vehicle.pricing.reset", vehicleId, JSON.stringify({ before, after })]);
    await client.query("commit");
    return after!.rules;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

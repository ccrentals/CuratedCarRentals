"use client";

import { useEffect, useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { formatJmd } from "@/lib/money";

type PromoRow = {
  id: string;
  public_id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  redemption_count: number;
  remaining_redemptions: number | null;
};

type PromoDetails = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  blackout_dates_json: string[];
};

type VehiclePromoPanelProps = {
  vehicleId: string;
  vehicleLabel: string;
};

function normalizePromoCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function generatePromoCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CCR-";
  for (let index = 0; index < 8; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    code += alphabet[randomIndex];
  }
  return code;
}

function toPromoRows(input: unknown): PromoRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry): PromoRow => ({
      id: String(entry.id ?? ""),
      public_id: String(entry.public_id ?? ""),
      code: String(entry.code ?? ""),
      is_active: entry.is_active === true,
      discount_type: entry.discount_type === "PERCENT" ? "PERCENT" : "FIXED",
      apply_scope: entry.apply_scope === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL",
      discount_value: Number(entry.discount_value ?? 0),
      min_subtotal_cents:
        entry.min_subtotal_cents === null ? null : Number(entry.min_subtotal_cents ?? 0),
      max_redemptions: entry.max_redemptions === null ? null : Number(entry.max_redemptions ?? 0),
      max_redemptions_per_customer:
        entry.max_redemptions_per_customer === null
          ? null
          : Number(entry.max_redemptions_per_customer ?? 0),
      start_at: typeof entry.start_at === "string" ? entry.start_at : null,
      end_at: typeof entry.end_at === "string" ? entry.end_at : null,
      allowed_vehicle_ids_json: Array.isArray(entry.allowed_vehicle_ids_json)
        ? entry.allowed_vehicle_ids_json.filter((item): item is string => typeof item === "string")
        : [],
      excluded_vehicle_ids_json: Array.isArray(entry.excluded_vehicle_ids_json)
        ? entry.excluded_vehicle_ids_json.filter((item): item is string => typeof item === "string")
        : [],
      redemption_count: Number(entry.redemption_count ?? 0),
      remaining_redemptions:
        entry.remaining_redemptions === null ? null : Number(entry.remaining_redemptions ?? 0),
    }))
    .filter((entry) => Boolean(entry.id));
}

function isScopedToVehicle(promo: PromoRow, vehicleId: string) {
  return (
    promo.allowed_vehicle_ids_json.includes(vehicleId) &&
    !promo.excluded_vehicle_ids_json.includes(vehicleId)
  );
}

export function VehiclePromoPanel({ vehicleId, vehicleLabel }: VehiclePromoPanelProps) {
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newCode, setNewCode] = useState("");
  const [newDiscountType, setNewDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [newApplyScope, setNewApplyScope] = useState<"OVERALL_TOTAL" | "DAYS_TOTAL">(
    "OVERALL_TOTAL",
  );
  const [newDiscountValue, setNewDiscountValue] = useState("");

  const [selectedPromoId, setSelectedPromoId] = useState("");

  const scopedPromos = useMemo(
    () => promos.filter((promo) => isScopedToVehicle(promo, vehicleId)),
    [promos, vehicleId],
  );
  const unscopedPromos = useMemo(
    () => promos.filter((promo) => !isScopedToVehicle(promo, vehicleId)),
    [promos, vehicleId],
  );

  async function loadPromos() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/promo-codes", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        promos?: unknown[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load promo codes.");
      }
      const rows = toPromoRows(payload.promos);
      setPromos(rows);
      if (rows.length > 0 && !rows.some((row) => row.id === selectedPromoId)) {
        setSelectedPromoId(rows[0]?.id ?? "");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load promo codes.");
      setPromos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPromos();
    // vehicleId is stable while page is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  async function toggleActive(promo: PromoRow) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          action: "set_active",
          isActive: !promo.is_active,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update promo status.");
      }
      setMessage(!promo.is_active ? "Promo activated." : "Promo deactivated.");
      await loadPromos();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update promo status.");
    } finally {
      setSaving(false);
    }
  }

  async function fetchPromoDetail(promoId: string) {
    const response = await fetch(`/api/admin/promo-codes/${promoId}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { promo?: PromoDetails; error?: string };
    if (!response.ok || !payload.promo) {
      throw new Error(payload.error ?? "Unable to load promo details.");
    }
    return payload.promo;
  }

  async function savePromoDetail(promoId: string, detail: PromoDetails, allowedVehicleIds: string[]) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/promo-codes/${promoId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        code: detail.code,
        isActive: detail.is_active,
        discountType: detail.discount_type,
        applyScope: detail.apply_scope,
        discountValue: detail.discount_value,
        minSubtotalCents: detail.min_subtotal_cents,
        maxRedemptions: detail.max_redemptions,
        maxRedemptionsPerCustomer: detail.max_redemptions_per_customer,
        startAt: detail.start_at,
        endAt: detail.end_at,
        allowedVehicleIds,
        excludedVehicleIds: detail.excluded_vehicle_ids_json.filter((id) => id !== vehicleId),
        blackoutDates: detail.blackout_dates_json,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to save promo.");
    }
  }

  async function scopeExistingPromo() {
    if (!selectedPromoId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await fetchPromoDetail(selectedPromoId);
      await savePromoDetail(selectedPromoId, detail, [vehicleId]);
      setMessage("Promo scoped to this vehicle.");
      await loadPromos();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : "Unable to scope promo.");
    } finally {
      setSaving(false);
    }
  }

  async function removePromoFromVehicle(promoId: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await fetchPromoDetail(promoId);
      const nextAllowed = detail.allowed_vehicle_ids_json.filter((id) => id !== vehicleId);
      await savePromoDetail(promoId, detail, nextAllowed);
      setMessage("Promo removed from this vehicle.");
      await loadPromos();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : "Unable to remove promo.");
    } finally {
      setSaving(false);
    }
  }

  async function createVehiclePromo() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const code = normalizePromoCode(newCode);
      const discountValue = Number(newDiscountValue);
      if (!code) throw new Error("Promo code is required.");
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new Error("Discount value must be greater than 0.");
      }
      if (newDiscountType === "PERCENT" && discountValue > 100) {
        throw new Error("Percent discounts cannot exceed 100.");
      }

      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          code,
          isActive: true,
          discountType: newDiscountType,
          applyScope: newApplyScope,
          discountValue,
          minSubtotalCents: null,
          maxRedemptions: null,
          maxRedemptionsPerCustomer: null,
          startAt: null,
          endAt: null,
          allowedVehicleIds: [vehicleId],
          excludedVehicleIds: [],
          blackoutDates: [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create promo.");
      }
      setNewCode("");
      setNewDiscountValue("");
      setNewDiscountType("PERCENT");
      setNewApplyScope("OVERALL_TOTAL");
      setMessage("Promo created for this vehicle.");
      await loadPromos();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create promo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
      <h2 className="text-xl font-bold text-[var(--ccr-text)]">Vehicle Promo Codes</h2>
      <p className="mt-1 text-sm text-[var(--ccr-muted)]">
        Create or scope promo codes for <span className="font-semibold text-[var(--ccr-text)]">{vehicleLabel}</span> only.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Create Promo For This Vehicle
          </h3>
          <div className="mt-3 grid gap-3">
            <label className="text-xs text-[var(--ccr-muted)]">
              Code
              <div className="mt-1 flex gap-2">
                <input
                  value={newCode}
                  onChange={(event) => setNewCode(event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="CCR-NEWPROMO"
                />
                <button
                  type="button"
                  onClick={() => setNewCode(generatePromoCode())}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Generate
                </button>
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--ccr-muted)]">
                Discount Type
                <select
                  value={newDiscountType}
                  onChange={(event) => setNewDiscountType(event.target.value as "PERCENT" | "FIXED")}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="PERCENT">Percent</option>
                  <option value="FIXED">Fixed (JMD)</option>
                </select>
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Apply To
                <select
                  value={newApplyScope}
                  onChange={(event) =>
                    setNewApplyScope(event.target.value as "OVERALL_TOTAL" | "DAYS_TOTAL")
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="OVERALL_TOTAL">Overall total</option>
                  <option value="DAYS_TOTAL">Rental days total only</option>
                </select>
              </label>
            </div>
            <label className="text-xs text-[var(--ccr-muted)]">
              Discount Value
              <input
                type="number"
                min={0}
                step="0.01"
                value={newDiscountValue}
                onChange={(event) => setNewDiscountValue(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <button
              type="button"
              onClick={createVehiclePromo}
              disabled={saving}
              className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Create Promo"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Scope Existing Promo
          </h3>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Makes the selected promo apply only to this vehicle.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedPromoId}
              onChange={(event) => setSelectedPromoId(event.target.value)}
              className="min-w-[220px] flex-1 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {unscopedPromos.length === 0 ? (
                <option value="">No unscoped promos</option>
              ) : (
                unscopedPromos.map((promo) => (
                  <option key={promo.id} value={promo.id}>
                    {promo.code} ({promo.discount_type === "PERCENT" ? `${promo.discount_value}%` : formatJmd(promo.discount_value)})
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={scopeExistingPromo}
              disabled={saving || !selectedPromoId || unscopedPromos.length === 0}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
            >
              Scope to Vehicle
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
        {loading ? (
          <div className="px-4 py-6 text-sm text-[var(--ccr-muted)]">Loading promos…</div>
        ) : scopedPromos.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--ccr-muted)]">
            No promo codes currently scoped to this vehicle.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Applies To</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scopedPromos.map((promo) => (
                <tr key={promo.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-[var(--ccr-text)]">{promo.code}</p>
                    <p className="mt-1 font-mono text-[10px] text-[var(--ccr-muted)]">{promo.public_id}</p>
                  </td>
                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                    {promo.discount_type === "PERCENT"
                      ? `${promo.discount_value}%`
                      : formatJmd(promo.discount_value)}
                  </td>
                  <td className="px-3 py-2 text-[var(--ccr-muted)]">
                    {promo.apply_scope === "DAYS_TOTAL" ? "Days total only" : "Overall total"}
                  </td>
                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                    {promo.is_active ? "Active" : "Inactive"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleActive(promo)}
                        disabled={saving}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        {promo.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removePromoFromVehicle(promo.id)}
                        disabled={saving}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {message ? <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
    </section>
  );
}

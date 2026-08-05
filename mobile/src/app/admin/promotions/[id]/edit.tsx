import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminPromo, type AdminPromoItem } from "@/admin/api";
import { AdminGate, AdminScreen } from "@/admin/AdminShell";
import { AdminPromoForm } from "@/admin/PromoForm";

export default function EditPromotionScreen() { return <AdminGate><EditPromotion /></AdminGate>; }

function EditPromotion() {
  const { id } = useLocalSearchParams<{ id?: string }>(); const { request } = useAdminAuth();
  const [promo, setPromo] = useState<AdminPromoItem | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => { if (!id) return; setError(""); try { setPromo((await fetchAdminPromo(request, id)).promo); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load this promotion."); } }, [id, request]);
  useEffect(() => { const task = setTimeout(() => void load(), 0); return () => clearTimeout(task); }, [load]);
  if (error) return <AdminScreen back eyebrow="EDIT CAMPAIGN" title="Promotion unavailable" subtitle={error} />;
  if (!promo) return <AdminScreen back eyebrow="EDIT CAMPAIGN" title="Loading promotion" subtitle="Preparing the current eligibility rules…" />;
  return <AdminPromoForm key={promo.updated_at} mode="edit" promo={promo} />;
}

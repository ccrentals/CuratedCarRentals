import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminPromos, type AdminPromoItem } from "@/admin/api";
import { hasCapability } from "@/admin/capabilities";
import { AdminButton, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function AdminPromotionsScreen() {
  return <AdminGate><PromotionsWorkspace /></AdminGate>;
}

function PromotionsWorkspace() {
  const { request, user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "promotions.read"));
  const canWrite = Boolean(user && hasCapability(user.role, "promotions.write"));
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchAdminPromos>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true); setError("");
    try { setData(await fetchAdminPromos(request, { q: query, page, rows: 20 })); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load promotions."); }
    finally { setLoading(false); }
  }, [allowed, page, query, request]);

  useEffect(() => { const task = setTimeout(() => void load(), 0); return () => clearTimeout(task); }, [load]);

  if (!allowed) return <AdminScreen back title="Workspace unavailable" subtitle="Promotion management requires administrator access." />;

  const promos = data?.promos ?? [];
  const active = promos.filter((promo) => promo.admin_state === "ACTIVE").length;
  const scheduled = promos.filter((promo) => promo.admin_state === "SCHEDULED").length;
  const attention = promos.filter((promo) => promo.admin_state === "EXPIRED" || promo.admin_state === "LIMIT_REACHED").length;
  const submitSearch = () => { setPage(1); setQuery(queryInput.trim()); };

  return <AdminScreen back eyebrow="REVENUE TOOLS" title="Promotions" subtitle="Control offers, eligibility windows, redemption limits, and discount exposure." refreshing={loading && promos.length > 0} onRefresh={() => void load()}>
    {canWrite ? <AdminButton label="Create promotion" icon="add" onPress={() => router.push("/admin/promotions/new" as Href)} /> : null}
    <View style={styles.searchRow}><View style={styles.search}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={submitSearch} placeholder="Promo code or reference" placeholderTextColor={colors.muted} autoCapitalize="characters" style={styles.searchInput} returnKeyType="search" /></View><Pressable onPress={submitSearch} style={styles.searchButton}><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable></View>
    <View style={styles.metrics}><Metric label="ACTIVE ON PAGE" value={String(active)} tone="good" /><Metric label="SCHEDULED" value={String(scheduled)} /><Metric label="ATTENTION" value={String(attention)} tone="warn" /><Metric label="TOTAL CODES" value={String(data?.totalCount ?? 0)} /></View>
    <View style={styles.result}><View><Text style={styles.resultTitle}>{loading && !data ? "Loading promotions…" : `${data?.totalCount ?? 0} ${(data?.totalCount ?? 0) === 1 ? "promotion" : "promotions"}`}</Text>{data && data.totalCount > 0 ? <Text style={styles.resultMeta}>Showing {data.from}–{data.to} · Page {data.page} of {data.totalPages}</Text> : null}</View>{query ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); setPage(1); }}><Text style={styles.clear}>Clear search</Text></Pressable> : null}</View>
    {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
    {!loading && !error && !promos.length ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="sell" size={27} color={colors.orange} /></View><Text style={styles.emptyTitle}>{query ? "No matching promotions" : "No promotions yet"}</Text><Text style={styles.emptyBody}>{query ? "Try another code or public reference." : "Create a controlled offer when the business is ready to run a campaign."}</Text></View> : null}
    <View style={styles.list}>{promos.map((promo) => <PromoCard key={promo.id} promo={promo} />)}</View>
    {data && (data.hasPrev || data.hasNext) ? <View style={styles.pager}><View style={styles.pagerButton}><AdminButton label="Previous" secondary disabled={!data.hasPrev || loading} onPress={() => setPage((current) => Math.max(1, current - 1))} /></View><Text style={styles.pageLabel}>{data.page} / {data.totalPages}</Text><View style={styles.pagerButton}><AdminButton label="Next" secondary disabled={!data.hasNext || loading} onPress={() => setPage((current) => current + 1)} /></View></View> : null}
    <View style={styles.guidance}><MaterialIcons name="verified-user" size={19} color={colors.tealDark} /><Text style={styles.guidanceText}>Eligibility and final discount amounts are always validated by the live booking service. The app displays policy—it does not override pricing.</Text></View>
  </AdminScreen>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); const color = tone === "good" ? colors.success : tone === "warn" ? colors.orangeDark : colors.tealDark; return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

function PromoCard({ promo }: { promo: AdminPromoItem }) {
  const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);
  const tone = promo.admin_state === "ACTIVE" ? "good" : promo.admin_state === "EXPIRED" || promo.admin_state === "LIMIT_REACHED" ? "warn" : "neutral";
  return <Pressable onPress={() => router.push(`/admin/promotions/${promo.id}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button"><View style={styles.cardTop}><View><Text style={styles.code}>{promo.code}</Text><Text style={styles.publicId}>{promo.public_id}</Text></View><View style={[styles.badge, tone === "good" && styles.badgeGood, tone === "warn" && styles.badgeWarn]}><Text style={[styles.badgeText, tone === "good" && styles.badgeTextGood, tone === "warn" && styles.badgeTextWarn]}>{humanize(promo.admin_state)}</Text></View></View><View style={styles.offerRow}><View><Text style={styles.offerValue}>{promo.discount_type === "PERCENT" ? `${promo.discount_value}%` : money(promo.discount_value)}</Text><Text style={styles.offerLabel}>{promo.apply_scope === "DAYS_TOTAL" ? "Rental-days discount" : "Overall subtotal discount"}</Text></View><View style={styles.usage}><Text style={styles.usageValue}>{promo.current_redemption_count}</Text><Text style={styles.usageLabel}>{promo.remaining_redemptions === null ? "used · unlimited" : `used · ${promo.remaining_redemptions} left`}</Text></View></View><View style={styles.window}><MaterialIcons name="date-range" size={16} color={colors.muted} /><Text style={styles.windowText}>{windowLabel(promo.start_at, promo.end_at)}</Text></View><View style={styles.constraints}><Text style={styles.constraintText}>{constraintLabel(promo)}</Text></View><View style={styles.open}><Text style={styles.openText}>Review promotion</Text><MaterialIcons name="chevron-right" size={21} color={colors.orange} /></View></Pressable>;
}

function constraintLabel(promo: AdminPromoItem) { const parts = [promo.min_subtotal_cents !== null ? `Min ${money(promo.min_subtotal_cents)}` : "No minimum", promo.max_redemptions_per_customer !== null ? `${promo.max_redemptions_per_customer}/customer` : "No customer cap"]; if (promo.allowed_vehicle_ids_json.length) parts.push(`${promo.allowed_vehicle_ids_json.length} allowed vehicles`); if (promo.excluded_vehicle_ids_json.length) parts.push(`${promo.excluded_vehicle_ids_json.length} exclusions`); if (promo.blackout_dates_json.length) parts.push(`${promo.blackout_dates_json.length} blackout dates`); return parts.join(" · "); }
function windowLabel(start: string | null, end: string | null) { if (!start && !end) return "Always available while active"; return `${start ? shortDate(start) : "Now"} → ${end ? shortDate(end) : "No end"}`; }
function shortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-JM", { dateStyle: "medium" }).format(date); }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0)); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 9 }, search: { flex: 1, minHeight: 50, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, searchInput: { flex: 1, color: colors.text, fontSize: 13 }, searchButton: { width: 50, height: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { width: "48%", minHeight: 74, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, metricValue: { fontSize: 23, fontWeight: "900" }, metricLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", marginTop: 4 },
  result: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" }, resultMeta: { color: colors.muted, fontSize: 9, marginTop: 3 }, clear: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  error: { flexDirection: "row", alignItems: "center", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 11 }, retry: { color: colors.tealDark, fontSize: 10, fontWeight: "900" }, empty: { alignItems: "center", padding: 28, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, emptyIcon: { width: 56, height: 56, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream }, emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 12 }, emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 5 },
  list: { gap: 10 }, card: { padding: 15, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, pressed: { opacity: 0.65 }, cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }, code: { color: colors.text, fontSize: 20, fontWeight: "900", letterSpacing: 0.7 }, publicId: { color: colors.muted, fontSize: 8, marginTop: 3 }, badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surfaceSoft }, badgeGood: { backgroundColor: colors.cream }, badgeWarn: { backgroundColor: colors.surfaceSoft }, badgeText: { color: colors.muted, fontSize: 8, fontWeight: "900" }, badgeTextGood: { color: colors.success }, badgeTextWarn: { color: colors.orangeDark }, offerRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 15 }, offerValue: { color: colors.orange, fontSize: 25, fontWeight: "900" }, offerLabel: { color: colors.muted, fontSize: 9, marginTop: 3 }, usage: { alignItems: "flex-end" }, usageValue: { color: colors.text, fontSize: 19, fontWeight: "900" }, usageLabel: { color: colors.muted, fontSize: 8, marginTop: 3 }, window: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }, windowText: { flex: 1, color: colors.muted, fontSize: 10 }, constraints: { marginTop: 9, padding: 9, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, constraintText: { color: colors.tealDark, fontSize: 9, lineHeight: 14, fontWeight: "700" }, open: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }, openText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  pager: { flexDirection: "row", alignItems: "center", gap: 9 }, pagerButton: { flex: 1 }, pageLabel: { color: colors.muted, fontSize: 10, fontWeight: "900" }, guidance: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.cream }, guidanceText: { flex: 1, color: colors.tealDark, fontSize: 10, lineHeight: 16, fontWeight: "700" },
});

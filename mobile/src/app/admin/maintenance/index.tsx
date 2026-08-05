import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminMaintenance, type AdminMaintenanceItem } from "@/admin/api";
import { hasCapability } from "@/admin/capabilities";
import { AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const DUE_FILTERS = [
  { key: "all", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "DUE_SOON", label: "Due soon" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "COMPLETED", label: "Completed" },
] as const;

const STATUS_FILTERS = ["all", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const CATEGORY_FILTERS = ["all", "SERVICE", "REPAIR", "INSPECTION", "REGISTRATION", "INSURANCE", "TIRE", "BRAKE", "BATTERY", "OTHER"] as const;

export default function AdminMaintenanceScreen() {
  return <AdminGate><MaintenanceWorkspace /></AdminGate>;
}

function MaintenanceWorkspace() {
  const { request, user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "maintenance.read"));
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [due, setDue] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [advanced, setAdvanced] = useState(false);
  const [items, setItems] = useState<AdminMaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setItems(await fetchAdminMaintenance(request, { q: query, dueState: due, status, category }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load fleet maintenance.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, category, due, query, request, status]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  if (!allowed) return <AdminScreen back title="Workspace unavailable" subtitle="Fleet maintenance requires administrator access." />;

  const overdue = items.filter((item) => item.dueState === "OVERDUE").length;
  const dueSoon = items.filter((item) => item.dueState === "DUE_SOON").length;
  const open = items.filter((item) => item.status === "SCHEDULED" || item.status === "IN_PROGRESS").length;
  const committedCost = items.filter((item) => item.status === "COMPLETED" || item.status === "IN_PROGRESS").reduce((sum, item) => sum + item.totalCostCents, 0);
  const activeFilters = Boolean(query || due !== "all" || status !== "all" || category !== "all");

  return <AdminScreen back eyebrow="FLEET READINESS" title="Maintenance" subtitle="Prioritize overdue service, monitor due-soon work, and protect vehicle availability." refreshing={loading && items.length > 0} onRefresh={() => void load()}>
    <View style={styles.searchRow}><View style={styles.search}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={() => setQuery(queryInput.trim())} placeholder="Vehicle, service, category, status" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" /></View><Pressable onPress={() => setQuery(queryInput.trim())} style={styles.searchButton}><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable></View>
    <View style={styles.metrics}><Metric icon="error-outline" label="OVERDUE" value={String(overdue)} tone="danger" /><Metric icon="schedule" label="DUE SOON" value={String(dueSoon)} tone="warn" /><Metric icon="build" label="OPEN WORK" value={String(open)} /><Metric icon="payments" label="ACTIVE COST" value={money(committedCost)} /></View>
    <View style={styles.filters}>{DUE_FILTERS.map((item) => <Pressable key={item.key} onPress={() => setDue(item.key)} style={[styles.filter, due === item.key && styles.filterActive]}><Text style={[styles.filterText, due === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>
    <Pressable onPress={() => setAdvanced((current) => !current)} style={styles.advancedButton}><MaterialIcons name="tune" size={18} color={colors.tealDark} /><Text style={styles.advancedText}>Status and category filters</Text><MaterialIcons name={advanced ? "expand-less" : "expand-more"} size={20} color={colors.muted} /></Pressable>
    {advanced ? <View style={styles.advanced}><Text style={styles.filterLabel}>WORK STATUS</Text><View style={styles.filters}>{STATUS_FILTERS.map((item) => <Pressable key={item} onPress={() => setStatus(item)} style={[styles.filter, status === item && styles.filterActive]}><Text style={[styles.filterText, status === item && styles.filterTextActive]}>{item === "all" ? "All statuses" : humanize(item)}</Text></Pressable>)}</View><Text style={styles.filterLabel}>CATEGORY</Text><View style={styles.filters}>{CATEGORY_FILTERS.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.filter, category === item && styles.filterActive]}><Text style={[styles.filterText, category === item && styles.filterTextActive]}>{item === "all" ? "All categories" : humanize(item)}</Text></Pressable>)}</View></View> : null}
    <View style={styles.result}><View><Text style={styles.resultTitle}>{loading && !items.length ? "Loading maintenance…" : `${items.length} ${items.length === 1 ? "record" : "records"}`}</Text><Text style={styles.resultMeta}>Sorted by operational due date</Text></View>{activeFilters ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); setDue("all"); setStatus("all"); setCategory("all"); }}><Text style={styles.clear}>Clear filters</Text></Pressable> : null}</View>
    {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
    {!loading && !error && !items.length ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="task-alt" size={27} color={colors.orange} /></View><Text style={styles.emptyTitle}>No maintenance matches</Text><Text style={styles.emptyBody}>The fleet has no records matching these readiness filters.</Text></View> : null}
    <View style={styles.list}>{items.map((item) => <MaintenanceCard key={item.id} item={item} />)}</View>
    <View style={styles.guidance}><MaterialIcons name="info-outline" size={19} color={colors.tealDark} /><Text style={styles.guidanceText}>Open the vehicle record to review its complete operational timeline and internal notes. Service record editing remains in the detailed fleet workflow.</Text></View>
  </AdminScreen>;
}

function Metric({ icon, label, value, tone }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; tone?: "danger" | "warn" }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const color = tone === "danger" ? colors.danger : tone === "warn" ? colors.orangeDark : colors.tealDark;
  return <View style={styles.metric}><MaterialIcons name={icon} size={18} color={color} /><Text style={[styles.metricValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function MaintenanceCard({ item }: { item: AdminMaintenanceItem }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const danger = item.dueState === "OVERDUE";
  const warning = item.dueState === "DUE_SOON";
  const date = item.nextDueDate || item.scheduledDate || item.serviceDate;
  return <View style={[styles.card, danger && styles.cardDanger, warning && styles.cardWarning]}><View style={styles.cardTop}><View style={[styles.categoryIcon, danger && styles.categoryIconDanger]}><MaterialIcons name={categoryIcon(item.category)} size={21} color={danger ? colors.danger : warning ? colors.orangeDark : colors.tealDark} /></View><View style={styles.cardCopy}><View style={styles.badges}><View style={[styles.badge, danger && styles.badgeDanger, warning && styles.badgeWarning]}><Text style={[styles.badgeText, danger && styles.badgeTextDanger, warning && styles.badgeTextWarning]}>{humanize(item.dueState)}</Text></View><View style={styles.priority}><Text style={styles.priorityText}>{item.priority}</Text></View></View><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.vehicle}>{item.vehicleLabel} · {item.vehiclePublicId}</Text></View></View><View style={styles.detailGrid}><Detail label="DUE" value={date ? longDate(date) : "No due date"} /><Detail label="STATUS" value={humanize(item.status)} /><Detail label="CATEGORY" value={humanize(item.category)} /><Detail label="COST" value={money(item.totalCostCents)} /></View>{item.currentOdometerKm !== null ? <View style={styles.odometer}><MaterialIcons name="speed" size={17} color={colors.muted} /><Text style={styles.odometerText}>{item.currentOdometerKm.toLocaleString("en-JM")} km current odometer</Text></View> : null}<Pressable onPress={() => router.push(`/admin/vehicles/${item.vehicleId}` as Href)} style={styles.open}><Text style={styles.openText}>Open vehicle record</Text><MaterialIcons name="chevron-right" size={21} color={colors.orange} /></Pressable></View>;
}

function Detail({ label, value }: { label: string; value: string }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function categoryIcon(category: string): React.ComponentProps<typeof MaterialIcons>["name"] { return category === "INSPECTION" ? "fact-check" : category === "INSURANCE" || category === "REGISTRATION" ? "description" : category === "TIRE" ? "tire-repair" : category === "BATTERY" ? "battery-charging-full" : "build"; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Number(value) || 0); }
function longDate(value: string) { const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 9 }, search: { flex: 1, minHeight: 50, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, searchInput: { flex: 1, color: colors.text, fontSize: 12 }, searchButton: { width: 50, height: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { width: "48%", minHeight: 88, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, metricValue: { fontSize: 21, fontWeight: "900", marginTop: 6 }, metricLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", marginTop: 2 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, filter: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, filterActive: { backgroundColor: colors.teal, borderColor: colors.teal }, filterText: { color: colors.muted, fontSize: 9, fontWeight: "900" }, filterTextActive: { color: colors.white }, filterLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 8 },
  advancedButton: { minHeight: 47, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.lg, backgroundColor: colors.cream }, advancedText: { flex: 1, color: colors.tealDark, fontSize: 10, fontWeight: "900" }, advanced: { gap: 9, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  result: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" }, resultMeta: { color: colors.muted, fontSize: 8, marginTop: 3 }, clear: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  error: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface }, errorText: { flex: 1, color: colors.danger, fontSize: 11 }, retry: { color: colors.tealDark, fontSize: 10, fontWeight: "900" }, empty: { alignItems: "center", padding: 26, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, emptyIcon: { width: 55, height: 55, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 12 }, emptyBody: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 5 },
  list: { gap: 9 }, card: { padding: 15, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, cardDanger: { borderColor: colors.danger }, cardWarning: { borderColor: colors.orange }, cardTop: { flexDirection: "row", gap: 10 }, categoryIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream }, categoryIconDanger: { backgroundColor: colors.surfaceSoft }, cardCopy: { flex: 1 }, badges: { flexDirection: "row", gap: 6 }, badge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.cream }, badgeDanger: { backgroundColor: colors.surfaceSoft }, badgeWarning: { backgroundColor: colors.surfaceSoft }, badgeText: { color: colors.success, fontSize: 7, fontWeight: "900" }, badgeTextDanger: { color: colors.danger }, badgeTextWarning: { color: colors.orangeDark }, priority: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceSoft }, priorityText: { color: colors.muted, fontSize: 7, fontWeight: "900" }, cardTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 7 }, vehicle: { color: colors.muted, fontSize: 9, marginTop: 3 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 13 }, detail: { width: "48%", padding: 9, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, detailLabel: { color: colors.muted, fontSize: 7, fontWeight: "900" }, detailValue: { color: colors.text, fontSize: 10, fontWeight: "800", marginTop: 4 }, odometer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }, odometerText: { color: colors.muted, fontSize: 9 }, open: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }, openText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  guidance: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.cream }, guidanceText: { flex: 1, color: colors.tealDark, fontSize: 10, lineHeight: 16, fontWeight: "700" },
});

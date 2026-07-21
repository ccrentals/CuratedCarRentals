import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminCustomers, type AdminCustomerListItem } from "@/admin/api";
import { AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const SORTS = [
  { key: "lastBooked", label: "Recent" },
  { key: "totalSpend", label: "Value" },
  { key: "bookings", label: "Bookings" },
  { key: "customer", label: "Name" },
] as const;

export default function AdminCustomersScreen() { return <AdminGate><CustomersList /></AdminGate>; }

function CustomersList() {
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]["key"]>("lastBooked");
  const [customers, setCustomers] = useState<AdminCustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setCustomers(await fetchAdminCustomers(request, { q: query, sortBy, sortDir: sortBy === "customer" ? "asc" : "desc" })); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load customers."); setCustomers([]); }
    finally { setLoading(false); }
  }, [query, request, sortBy]);

  useEffect(() => { const task = setTimeout(() => void load(), 0); return () => clearTimeout(task); }, [load]);
  const submitSearch = () => setQuery(queryInput.trim());

  const addAction = <Pressable onPress={() => router.push("/admin/customers/new" as Href)} style={styles.headerAction} accessibilityRole="button" accessibilityLabel="Add customer"><MaterialIcons name="person-add" size={21} color={colors.white} /></Pressable>;
  return (
    <AdminScreen back eyebrow="RELATIONSHIPS" title="Customers" subtitle="Understand every renter, trip, and relationship." action={addAction} refreshing={loading && customers.length > 0} onRefresh={() => void load()}>
      <View style={styles.searchRow}><View style={styles.searchBox}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={submitSearch} placeholder="Name, email, or phone" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" autoCapitalize="none" /></View><Pressable onPress={submitSearch} style={styles.searchButton}><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable></View>
      <View style={styles.sortRow}>{SORTS.map((sort) => <Pressable key={sort.key} onPress={() => setSortBy(sort.key)} style={[styles.sortChip, sortBy === sort.key && styles.sortChipActive]}><Text style={[styles.sortText, sortBy === sort.key && styles.sortTextActive]}>{sort.label}</Text></Pressable>)}</View>
      <View style={styles.resultHeader}><Text style={styles.resultTitle}>{loading && !customers.length ? "Loading customers…" : `${customers.length} ${customers.length === 1 ? "customer" : "customers"}`}</Text>{query ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); }}><Text style={styles.clearText}>Clear search</Text></Pressable> : null}</View>
      {error ? <View style={styles.errorCard}><MaterialIcons name="error-outline" size={21} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
      {!loading && !error && customers.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="person-search" size={30} color={colors.orange} /></View><Text style={styles.emptyTitle}>No customers found</Text><Text style={styles.emptyBody}>{query ? "Try another name, email, or phone number." : "Add the first customer to begin building the relationship history."}</Text></View> : null}
      <View style={styles.list}>{customers.map((customer) => <CustomerCard key={customer.id} customer={customer} />)}</View>
    </AdminScreen>
  );
}

function CustomerCard({ customer }: { customer: AdminCustomerListItem }) {
  const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Pressable onPress={() => router.push(`/admin/customers/${customer.id}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} accessibilityRole="button"><View style={styles.cardTop}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(customer.full_name)}</Text></View><View style={styles.cardCopy}><Text style={styles.customerName}>{customer.full_name || "Unnamed customer"}</Text><Text style={styles.customerEmail}>{customer.email || customer.phone || "No contact details"}</Text></View><MaterialIcons name="chevron-right" size={22} color={colors.orange} /></View><View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricValue}>{customer.total_bookings}</Text><Text style={styles.metricLabel}>Bookings</Text></View><View style={styles.metricDivider} /><View style={styles.metric}><Text style={styles.metricValue}>{formatStoredJmd(customer.total_spend)}</Text><Text style={styles.metricLabel}>Lifetime paid</Text></View><View style={styles.metricDivider} /><View style={styles.metric}><Text style={styles.metricValueSmall}>{customer.last_booked_at ? dateOnly(customer.last_booked_at) : "—"}</Text><Text style={styles.metricLabel}>Last booked</Text></View></View></Pressable>;
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"; }
function dateOnly(value: string) { return String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value); }
function formatStoredJmd(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0)); }
const makeStyles = (colors: AppColors) => StyleSheet.create({
  headerAction: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" }, searchRow: { flexDirection: "row", gap: 9 }, searchBox: { flex: 1, minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 12 }, searchButton: { width: 50, height: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, sortChip: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, sortChipActive: { backgroundColor: colors.teal, borderColor: colors.teal }, sortText: { color: colors.muted, fontSize: 11, fontWeight: "800" }, sortTextActive: { color: colors.white }, resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 5 }, resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" }, clearText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 12 }, retry: { color: colors.tealDark, fontSize: 11, fontWeight: "900" }, empty: { alignItems: "center", padding: 28, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, emptyIcon: { width: 60, height: 60, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream }, emptyTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 15 }, emptyBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 }, list: { gap: 10 },
  card: { padding: 16, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, cardPressed: { opacity: 0.65 }, cardTop: { flexDirection: "row", alignItems: "center", gap: 11 }, avatar: { width: 46, height: 46, borderRadius: 17, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.tealDark, fontSize: 14, fontWeight: "900" }, cardCopy: { flex: 1 }, customerName: { color: colors.text, fontSize: 17, fontWeight: "900" }, customerEmail: { color: colors.muted, fontSize: 11, marginTop: 4 }, metrics: { flexDirection: "row", alignItems: "stretch", marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.border }, metric: { flex: 1 }, metricValue: { color: colors.text, fontSize: 13, fontWeight: "900" }, metricValueSmall: { color: colors.text, fontSize: 11, fontWeight: "900" }, metricLabel: { color: colors.muted, fontSize: 9, marginTop: 3 }, metricDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 9 },
});

import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminQuotes, type AdminQuoteListItem } from "@/admin/api";
import { AdminButton, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "SENT", label: "Sent" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "CONVERTED", label: "Converted" },
] as const;

export default function AdminQuotesScreen() {
  return <AdminGate><QuotesList /></AdminGate>;
}

function QuotesList() {
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [quotes, setQuotes] = useState<AdminQuoteListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor: string | null = null) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    if (!cursor) setError("");
    try {
      const page = await fetchAdminQuotes(request, { q: query, status, cursor, limit: 20 });
      setQuotes((current) => cursor
        ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]
        : page.items);
      setTotalCount(page.totalCount);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load quotes.");
      if (!cursor) setQuotes([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, request, status]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const submitSearch = () => setQuery(queryInput.trim());
  const filtered = query || status !== "all";

  return (
    <AdminScreen back eyebrow="SALES PIPELINE" title="Quotes" subtitle="Follow every estimate from draft through booking." refreshing={loading && quotes.length > 0} onRefresh={() => void load()}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={submitSearch} placeholder="Quote, customer, email, vehicle" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" autoCapitalize="none" /></View>
        <Pressable onPress={submitSearch} style={styles.searchButton} accessibilityRole="button" accessibilityLabel="Search quotes"><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable>
      </View>

      <View style={styles.filterRow}>{STATUS_FILTERS.map((filter) => <Pressable key={filter.key} onPress={() => setStatus(filter.key)} style={[styles.filterChip, status === filter.key && styles.filterChipActive]}><Text style={[styles.filterText, status === filter.key && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</View>

      <View style={styles.resultHeader}><Text style={styles.resultTitle}>{loading && !quotes.length ? "Loading quotes…" : `${totalCount} ${totalCount === 1 ? "quote" : "quotes"}`}</Text>{filtered ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); setStatus("all"); }}><Text style={styles.clearText}>Clear filters</Text></Pressable> : null}</View>

      {error ? <View style={styles.errorCard}><MaterialIcons name="error-outline" size={21} color={colors.danger} /><View style={styles.errorCopy}><Text style={styles.errorTitle}>Couldn’t load quotes</Text><Text style={styles.errorBody}>{error}</Text></View><Pressable onPress={() => void load()}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && !error && quotes.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="request-quote" size={29} color={colors.orange} /></View><Text style={styles.emptyTitle}>No quotes match</Text><Text style={styles.emptyBody}>Clear the filters or search for another customer, reference, or vehicle.</Text></View> : null}

      <View style={styles.list}>{quotes.map((quote) => <QuoteCard key={quote.id} quote={quote} />)}</View>
      {hasMore && nextCursor ? <AdminButton label={loadingMore ? "Loading more…" : "Load more quotes"} onPress={() => void load(nextCursor)} disabled={loadingMore} secondary /> : null}
    </AdminScreen>
  );
}

function QuoteCard({ quote }: { quote: AdminQuoteListItem }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const effectiveStatus = getEffectiveStatus(quote.status, quote.expiresAt);
  const tone = statusTone(effectiveStatus);
  return (
    <Pressable onPress={() => router.push(`/admin/quotes/${quote.id}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} accessibilityRole="button">
      <View style={styles.cardTop}><Text style={styles.quoteId}>{quote.publicId || quote.id.slice(0, 8).toUpperCase()}</Text><View style={[styles.statusBadge, tone === "good" && styles.statusGood, tone === "warning" && styles.statusWarning]}><Text style={[styles.statusText, tone === "good" && styles.statusTextGood, tone === "warning" && styles.statusTextWarning]}>{humanize(effectiveStatus)}</Text></View></View>
      <View style={styles.amountRow}><View style={styles.amountCopy}><Text style={styles.customerName}>{quote.customerFullName}</Text><Text style={styles.customerEmail}>{quote.customerEmail}</Text></View><Text style={styles.amount}>{formatStoredJmd(quote.totalCents)}</Text></View>
      <View style={styles.metaRow}><MaterialIcons name="directions-car" size={16} color={colors.tealDark} /><Text style={styles.metaText}>{quote.vehicleLabel}</Text></View>
      <View style={styles.metaRow}><MaterialIcons name="date-range" size={16} color={colors.muted} /><Text style={styles.metaText}>{dateOnly(quote.startAt)} → {dateOnly(quote.endAt)}</Text></View>
      <View style={styles.openRow}><Text style={styles.openText}>Review quote</Text><MaterialIcons name="chevron-right" size={21} color={colors.orange} /></View>
    </Pressable>
  );
}

function getEffectiveStatus(status: string, expiresAt: string | null) {
  if (!["CONVERTED", "CANCELLED", "EXPIRED"].includes(status) && expiresAt && new Date(expiresAt).getTime() < Date.now()) return "EXPIRED";
  return status;
}

function statusTone(status: string) {
  if (["ACCEPTED", "CONVERTED"].includes(status)) return "good";
  if (["DRAFT", "SENT"].includes(status)) return "warning";
  return "neutral";
}

function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function dateOnly(value: string) { return String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value); }
function formatStoredJmd(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0)); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 9 },
  searchBox: { flex: 1, minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 12 },
  searchButton: { width: 50, height: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: colors.white },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
  resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  clearText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  errorCopy: { flex: 1 }, errorTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, errorBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, retryText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  empty: { alignItems: "center", padding: 28, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream }, emptyTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 15 }, emptyBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 },
  list: { gap: 10 }, card: { padding: 16, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, cardPressed: { opacity: 0.65 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, quoteId: { color: colors.orange, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.surfaceSoft }, statusGood: { backgroundColor: colors.cream }, statusWarning: { backgroundColor: colors.surfaceSoft },
  statusText: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" }, statusTextGood: { color: colors.success }, statusTextWarning: { color: colors.orangeDark },
  amountRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 }, amountCopy: { flex: 1 }, customerName: { color: colors.text, fontSize: 18, fontWeight: "900" }, customerEmail: { color: colors.muted, fontSize: 11, marginTop: 3 }, amount: { color: colors.text, fontSize: 17, fontWeight: "900" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 9 }, metaText: { flex: 1, color: colors.muted, fontSize: 11 },
  openRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }, openText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
});

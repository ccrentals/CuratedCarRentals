import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminBookings, type AdminBookingListItem } from "@/admin/api";
import { AdminButton, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_payment", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "completed", label: "Returned" },
] as const;

export default function AdminBookingsScreen() {
  return <AdminGate><BookingsList /></AdminGate>;
}

function BookingsList() {
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState("all");
  const [bookings, setBookings] = useState<AdminBookingListItem[]>([]);
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
      const page = await fetchAdminBookings(request, { q: query, status, scope, cursor, limit: 20 });
      setBookings((current) => cursor ? [...current, ...page.bookings.filter((item) => !current.some((existing) => existing.id === item.id))] : page.bookings);
      setTotalCount(page.totalCount);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load bookings.");
      if (!cursor) setBookings([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, request, scope, status]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const submitSearch = () => setQuery(queryInput.trim());

  return (
    <AdminScreen back eyebrow="RESERVATIONS" title="Bookings" subtitle="Search, review, and manage every customer trip." refreshing={loading && bookings.length > 0} onRefresh={() => void load()}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={submitSearch} placeholder="Booking, customer, email, vehicle" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" autoCapitalize="none" /></View>
        <Pressable onPress={submitSearch} style={styles.searchButton} accessibilityRole="button"><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable>
      </View>

      <View style={styles.filterRow}>{STATUS_FILTERS.map((filter) => <Pressable key={filter.key} onPress={() => setStatus(filter.key)} style={[styles.filterChip, status === filter.key && styles.filterChipActive]}><Text style={[styles.filterText, status === filter.key && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</View>
      <Pressable onPress={() => setScope((current) => current === "upcoming" ? "all" : "upcoming")} style={[styles.upcomingToggle, scope === "upcoming" && styles.upcomingToggleActive]}><MaterialIcons name="upcoming" size={17} color={scope === "upcoming" ? colors.white : colors.tealDark} /><Text style={[styles.upcomingText, scope === "upcoming" && styles.upcomingTextActive]}>Upcoming trips only</Text></Pressable>

      <View style={styles.resultHeader}><Text style={styles.resultTitle}>{loading && !bookings.length ? "Loading bookings…" : `${totalCount} ${totalCount === 1 ? "booking" : "bookings"}`}</Text>{query || status !== "all" || scope !== "all" ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); setStatus("all"); setScope("all"); }}><Text style={styles.clearText}>Clear filters</Text></Pressable> : null}</View>

      {error ? <View style={styles.errorCard}><MaterialIcons name="error-outline" size={21} color={colors.danger} /><View style={styles.errorCopy}><Text style={styles.errorTitle}>Couldn’t load bookings</Text><Text style={styles.errorBody}>{error}</Text></View><Pressable onPress={() => void load()}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {!loading && !error && bookings.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="event-busy" size={29} color={colors.orange} /></View><Text style={styles.emptyTitle}>No bookings match</Text><Text style={styles.emptyBody}>Try a different status, clear the search, or switch off the upcoming filter.</Text></View> : null}

      <View style={styles.list}>{bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)}</View>
      {hasMore && nextCursor ? <AdminButton label={loadingMore ? "Loading more…" : "Load more bookings"} onPress={() => void load(nextCursor)} disabled={loadingMore} secondary /> : null}
    </AdminScreen>
  );
}

function BookingCard({ booking }: { booking: AdminBookingListItem }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pending = booking.status.toUpperCase().includes("PENDING");
  return <Pressable onPress={() => router.push(`/admin/bookings/${booking.id}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} accessibilityRole="button"><View style={styles.cardTop}><Text style={styles.bookingId}>{booking.publicId || booking.id.slice(0, 8).toUpperCase()}</Text><View style={[styles.statusBadge, pending && styles.statusBadgePending]}><Text style={[styles.statusText, pending && styles.statusTextPending]}>{booking.statusLabel}</Text></View></View><Text style={styles.customerName}>{booking.customerName}</Text><Text style={styles.customerEmail}>{booking.customerEmail}</Text><View style={styles.vehicleRow}><MaterialIcons name="directions-car" size={16} color={colors.tealDark} /><Text style={styles.vehicleText}>{booking.vehicleLabel}</Text></View><View style={styles.tripRow}><MaterialIcons name="date-range" size={16} color={colors.muted} /><Text style={styles.tripText}>{booking.startDateIso} → {booking.endDateIso}</Text></View>{booking.substatusIndicators[0] ? <View style={styles.substatus}><MaterialIcons name="info-outline" size={15} color={colors.orangeDark} /><Text style={styles.substatusText}>{booking.substatusIndicators[0].message}</Text></View> : null}<View style={styles.openRow}><Text style={styles.openText}>Open reservation</Text><MaterialIcons name="chevron-right" size={21} color={colors.orange} /></View></Pressable>;
}

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
  upcomingToggle: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, minHeight: 38, paddingHorizontal: 13, borderRadius: radii.pill, backgroundColor: colors.cream },
  upcomingToggleActive: { backgroundColor: colors.teal },
  upcomingText: { color: colors.tealDark, fontSize: 11, fontWeight: "800" },
  upcomingTextActive: { color: colors.white },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
  resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  clearText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  errorBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  retryText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  empty: { alignItems: "center", padding: 28, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 15 },
  emptyBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 },
  list: { gap: 10 },
  card: { padding: 16, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardPressed: { opacity: 0.65 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bookingId: { color: colors.orange, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.cream },
  statusBadgePending: { backgroundColor: colors.surfaceSoft },
  statusText: { color: colors.success, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  statusTextPending: { color: colors.orangeDark },
  customerName: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 11 },
  customerEmail: { color: colors.muted, fontSize: 11, marginTop: 3 },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 11 },
  vehicleText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  tripRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  tripText: { color: colors.muted, fontSize: 11 },
  substatus: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 9, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, marginTop: 10 },
  substatusText: { flex: 1, color: colors.orangeDark, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  openRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  openText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
});

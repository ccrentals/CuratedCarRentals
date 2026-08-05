import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Notice, PageIntro, Screen } from "@/components/primitives";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { fetchBookingStatus, startDepositPayment, type BookingStatus } from "@/services/api";
import { getSavedBookings, removeSavedBooking, type SavedBooking } from "@/services/bookingStore";

export default function BookingStatusScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const [bookings, setBookings] = useState<SavedBooking[]>([]);
  const [statuses, setStatuses] = useState<Record<string, BookingStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async (booking: SavedBooking) => {
    setBusyId(booking.bookingId);
    setErrors((current) => ({ ...current, [booking.bookingId]: "" }));
    try {
      const nextStatus = await fetchBookingStatus(booking.bookingId, booking.bookingAccessToken);
      setStatuses((current) => ({ ...current, [booking.bookingId]: nextStatus }));
    } catch (refreshError) {
      setErrors((current) => ({
        ...current,
        [booking.bookingId]: refreshError instanceof Error ? refreshError.message : "Unable to refresh this reservation.",
      }));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    let active = true;
    void getSavedBookings().then(async (savedBookings) => {
      if (!active) return;
      setBookings(savedBookings);
      const results = await Promise.allSettled(savedBookings.map(async (booking) => ({
        bookingId: booking.bookingId,
        status: await fetchBookingStatus(booking.bookingId, booking.bookingAccessToken),
      })));
      if (!active) return;
      const nextStatuses: Record<string, BookingStatus> = {};
      results.forEach((result) => {
        if (result.status === "fulfilled") nextStatuses[result.value.bookingId] = result.value.status;
      });
      setStatuses(nextStatuses);
      setLoading(false);
    }).catch(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const payDeposit = async (booking: SavedBooking) => {
    setBusyId(booking.bookingId);
    setErrors((current) => ({ ...current, [booking.bookingId]: "" }));
    try {
      const nextStatus = await startDepositPayment(booking.bookingId, booking.bookingAccessToken);
      setStatuses((current) => ({ ...current, [booking.bookingId]: nextStatus }));
    } catch (paymentError) {
      setErrors((current) => ({
        ...current,
        [booking.bookingId]: paymentError instanceof Error ? paymentError.message : "Unable to start deposit payment.",
      }));
    } finally {
      setBusyId(null);
    }
  };

  const forget = async (bookingId: string) => {
    setBookings(await removeSavedBooking(bookingId));
    setStatuses((current) => {
      const next = { ...current };
      delete next[bookingId];
      return next;
    });
  };

  return (
    <Screen>
      <PageIntro eyebrow="Your reservations" title="My Bookings" description="Review reservations saved securely on this device and continue outstanding payments." />
      <Card style={styles.securityCard}>
        <View style={styles.securityHeader}><Text style={styles.securityIcon}>▣</Text><Text style={styles.securityTitle}>Private on-device access</Text></View>
        <Text style={styles.securityBody}>Each booking’s private access token is encrypted on this device—not stored in a temporary cache. Reservations survive normal restarts and app updates.</Text>
        <Text style={styles.syncNote}>Only bookings made on this device appear here. Account-based cross-device sync requires customer sign-in and is not enabled yet.</Text>
      </Card>

      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>Checking saved reservations…</Text></View> : null}
      {!loading && bookings.length === 0 ? (
        <Card>
          <Text style={styles.title}>No saved bookings</Text>
          <Text style={styles.body}>Complete a reservation in the Book tab and it will appear here automatically.</Text>
          <Button label="Start a reservation" href="/(tabs)/book" />
        </Card>
      ) : null}

      {bookings.map((booking) => {
        const status = statuses[booking.bookingId];
        const isBusy = busyId === booking.bookingId;
        const isPaid = status?.paymentStatus === "DEPOSIT_PAID" || status?.paymentStatus === "PAID_IN_FULL";
        return (
          <Card key={booking.bookingId}>
            <View style={styles.bookingHeader}>
              <View style={styles.bookingHeaderCopy}>
                <Text style={styles.savedLabel}>SAVED RESERVATION</Text>
                <Text style={styles.title}>{status?.reference || booking.bookingId.slice(0, 8).toUpperCase()}</Text>
                {booking.vehicleName ? <Text style={styles.vehicleName}>{booking.vehicleName}</Text> : null}
              </View>
              <View style={[styles.statusBadge, isPaid && styles.statusBadgePaid]}><Text style={[styles.statusBadgeText, isPaid && styles.statusBadgeTextPaid]}>{(status?.paymentStatus || booking.status).replaceAll("_", " ")}</Text></View>
            </View>
            {booking.startDate && booking.endDate ? <Row label="Trip" value={`${booking.startDate} → ${booking.endDate}`} /> : null}
            <Row label="Reservation" value={(status?.status || booking.status).replaceAll("_", " ")} />
            {status ? (
              <>
                <Row label="Total" value={formatJmd(status.total)} />
                <Row label="Paid" value={formatJmd(status.paidToDate)} />
                <Row label="Balance" value={formatJmd(status.balanceDue)} strong />
              </>
            ) : <Text style={styles.offlineText}>Saved locally. Refresh when connected to retrieve current totals and payment status.</Text>}
            <Text style={styles.savedAt}>Saved {new Date(booking.savedAt).toLocaleDateString("en-JM", { year: "numeric", month: "short", day: "numeric" })}</Text>
            <Button label={isBusy ? "Refreshing…" : "Refresh status"} onPress={() => void refresh(booking)} disabled={isBusy} secondary />
            {!isPaid ? <Button label={isBusy ? "Please wait…" : "Pay deposit securely"} onPress={() => void payDeposit(booking)} disabled={isBusy} /> : null}
            <Pressable onPress={() => void forget(booking.bookingId)} style={styles.removeButton} accessibilityRole="button"><Text style={styles.removeText}>Remove from this device</Text></Pressable>
            {errors[booking.bookingId] ? <Notice error>{errors[booking.bookingId]}</Notice> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, strong && styles.valueStrong]}>{value}</Text></View>;
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  securityCard: { backgroundColor: isDark ? colors.navySoft : "#ECF7F3", borderColor: colors.teal },
  securityHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  securityIcon: { color: colors.orange, fontSize: 20, fontWeight: "900" },
  securityTitle: { color: colors.tealDark, fontSize: 18, fontWeight: "900" },
  securityBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginTop: 10 },
  syncNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 8 },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 34 },
  loadingText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 10 },
  bookingHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  bookingHeaderCopy: { flex: 1 },
  savedLabel: { color: colors.orange, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 5 },
  vehicleName: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 4 },
  statusBadge: { maxWidth: "42%", borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.surfaceSoft },
  statusBadgePaid: { backgroundColor: isDark ? colors.navySoft : "#DDF2EA" },
  statusBadgeText: { color: colors.muted, fontSize: 8, fontWeight: "900", textTransform: "uppercase", textAlign: "center" },
  statusBadgeTextPaid: { color: colors.success },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  value: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: "800", textAlign: "right", textTransform: "capitalize" },
  valueStrong: { color: colors.tealDark, fontSize: 14, fontWeight: "900" },
  offlineText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12 },
  savedAt: { color: colors.muted, fontSize: 10, marginTop: 12 },
  removeButton: { alignItems: "center", paddingVertical: 14, marginTop: 5 },
  removeText: { color: colors.danger, fontSize: 12, fontWeight: "800" },
});

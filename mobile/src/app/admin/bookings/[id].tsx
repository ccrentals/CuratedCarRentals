import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminBooking, updateAdminBookingStatus, type AdminBookingDetail } from "@/admin/api";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function AdminBookingDetailScreen() {
  return <AdminGate><BookingDetail /></AdminGate>;
}

function BookingDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      setDetail(await fetchAdminBooking(request, id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this booking.");
    } finally {
      setLoading(false);
    }
  }, [id, request]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const runAction = (action: "confirm" | "pickup" | "complete") => {
    if (!detail || !id) return;
    const copy = action === "confirm"
      ? { title: "Confirm reservation?", body: "This changes the reservation status to confirmed." }
      : action === "pickup"
        ? { title: "Mark vehicle picked up?", body: "The server will verify full payment and a completed pickup inspection first." }
        : { title: "Complete rental?", body: "The server will verify the return inspection before closing this rental." };
    Alert.alert(copy.title, copy.body, [
      { text: "Not now", style: "cancel" },
      { text: "Continue", onPress: () => void performAction(action) },
    ]);
  };

  const performAction = async (action: "confirm" | "pickup" | "complete") => {
    if (!id) return;
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      const result = await updateAdminBookingStatus(request, id, action);
      setNotice(result.message || "Reservation updated successfully.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update this reservation.");
    } finally {
      setBusyAction("");
    }
  };

  const reference = detail?.booking.public_id || id?.slice(0, 8).toUpperCase() || "Booking";
  const status = detail?.booking.status.toUpperCase() ?? "";
  const primaryAction = status === "PENDING_PAYMENT" || status === "PENDING"
    ? { action: "confirm" as const, label: "Confirm reservation", icon: "verified" as const }
    : status === "CONFIRMED"
      ? { action: "pickup" as const, label: "Mark as picked up", icon: "key" as const }
      : status === "PICKED_UP"
        ? { action: "complete" as const, label: "Complete rental", icon: "task-alt" as const }
        : null;

  return (
    <AdminScreen back eyebrow="BOOKING DETAIL" title={reference} subtitle={detail ? `${detail.customer.full_name} · ${detail.vehicle.year} ${detail.vehicle.make} ${detail.vehicle.model}` : "Loading reservation details…"} refreshing={loading && Boolean(detail)} onRefresh={() => void load()}>
      {loading && !detail ? <AdminCard style={styles.loadingCard}><View style={styles.loadingLineLarge} /><View style={styles.loadingLine} /><View style={styles.loadingLineSmall} /></AdminCard> : null}
      {error ? <View style={styles.errorCard}><MaterialIcons name="error-outline" size={21} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
      {notice ? <View style={styles.noticeCard}><MaterialIcons name="check-circle" size={20} color={colors.success} /><Text style={styles.noticeText}>{notice}</Text></View> : null}

      {detail ? (
        <>
          <AdminCard>
            <View style={styles.statusHeader}><View><Text style={styles.label}>RESERVATION STATUS</Text><Text style={styles.statusTitle}>{humanize(detail.booking.status)}</Text></View><View style={styles.statusIcon}><MaterialIcons name="event-available" size={24} color={colors.tealDark} /></View></View>
            <View style={styles.divider} />
            <DetailRow icon="date-range" label="Trip" value={`${dateOnly(detail.booking.start_date)} → ${dateOnly(detail.booking.end_date)}`} />
            <DetailRow icon="place" label="Pickup" value={detail.booking.pickup_location || "Not recorded"} />
            <DetailRow icon="directions-car" label="Vehicle" value={`${detail.vehicle.year} ${detail.vehicle.make} ${detail.vehicle.model}`} />
            {detail.booking.non_blocking ? <View style={styles.warning}><MaterialIcons name="warning-amber" size={18} color={colors.orangeDark} /><Text style={styles.warningText}>This unpaid reservation is not currently holding the vehicle.</Text></View> : null}
            {detail.booking.overridden_by_booking_id ? <View style={styles.warning}><MaterialIcons name="priority-high" size={18} color={colors.danger} /><Text style={styles.warningText}>This reservation was overridden by another paid booking.</Text></View> : null}
          </AdminCard>

          <AdminCard>
            <Text style={styles.sectionTitle}>Customer</Text>
            <DetailRow icon="person" label="Name" value={detail.customer.full_name} />
            <DetailRow icon="mail" label="Email" value={detail.customer.email} />
            <DetailRow icon="phone" label="Phone" value={detail.customer.phone || "Not recorded"} />
          </AdminCard>

          <AdminCard>
            <Text style={styles.sectionTitle}>Payment summary</Text>
            <View style={styles.moneyHero}><View><Text style={styles.moneyLabel}>BALANCE DUE</Text><Text style={styles.moneyValue}>{formatStoredJmd(detail.booking.balance_due)}</Text></View><View style={styles.paymentBadge}><Text style={styles.paymentBadgeText}>{humanize(detail.booking.payment_status)}</Text></View></View>
            <View style={styles.divider} />
            <InfoRow label="Payment choice" value={humanize(detail.booking.payment_option)} />
            <InfoRow label="Paid to date" value={formatStoredJmd(detail.booking.amount_paid)} />
            <InfoRow label="Transactions" value={String(detail.payments.length)} />
          </AdminCard>

          {detail.payments.length ? <AdminCard><Text style={styles.sectionTitle}>Payment activity</Text>{detail.payments.map((payment) => <View key={payment.id} style={styles.paymentRow}><View style={styles.paymentIcon}><MaterialIcons name="receipt-long" size={18} color={colors.tealDark} /></View><View style={styles.paymentCopy}><Text style={styles.paymentTitle}>{payment.public_id || payment.provider}</Text><Text style={styles.paymentMeta}>{humanize(payment.provider)} · {dateOnly(payment.created_at)}</Text></View><View><Text style={styles.paymentAmount}>{formatStoredJmd(payment.deposit_amount_cents)}</Text><Text style={styles.paymentStatus}>{humanize(payment.status)}</Text></View></View>)}</AdminCard> : null}

          {primaryAction ? <AdminCard><Text style={styles.sectionTitle}>Next operational step</Text><Text style={styles.actionBody}>The server will validate every prerequisite before changing this booking.</Text><AdminButton label={busyAction ? "Updating reservation…" : primaryAction.label} onPress={() => runAction(primaryAction.action)} disabled={Boolean(busyAction)} icon={primaryAction.icon} /></AdminCard> : null}
        </>
      ) : null}
    </AdminScreen>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.detailRow}><View style={styles.detailIcon}><MaterialIcons name={icon} size={18} color={colors.tealDark} /></View><View style={styles.detailCopy}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function humanize(value: string) {
  return String(value || "Not recorded").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateOnly(value: string) {
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || String(value);
}

function formatStoredJmd(value: number) {
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0));
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  loadingCard: { gap: 12 },
  loadingLineLarge: { width: "55%", height: 24, borderRadius: 7, backgroundColor: colors.surfaceSoft },
  loadingLine: { width: "100%", height: 16, borderRadius: 6, backgroundColor: colors.surfaceSoft },
  loadingLineSmall: { width: "72%", height: 16, borderRadius: 6, backgroundColor: colors.surfaceSoft },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
  retry: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  noticeCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 13, borderRadius: radii.lg, backgroundColor: colors.cream },
  noticeText: { flex: 1, color: colors.success, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  statusHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  statusTitle: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 5 },
  statusIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginTop: 13 },
  detailIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" },
  detailCopy: { flex: 1, paddingTop: 1 },
  detailLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  detailValue: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "800", marginTop: 3 },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, marginTop: 15 },
  warningText: { flex: 1, color: colors.orangeDark, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginBottom: 4 },
  moneyHero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 },
  moneyLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  moneyValue: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4 },
  paymentBadge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.cream },
  paymentBadgeText: { color: colors.tealDark, fontSize: 9, fontWeight: "900" },
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 7 },
  infoLabel: { color: colors.muted, fontSize: 12 },
  infoValue: { color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "right" },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  paymentIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  paymentCopy: { flex: 1 },
  paymentTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  paymentMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  paymentAmount: { color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "right" },
  paymentStatus: { color: colors.success, fontSize: 9, fontWeight: "800", textAlign: "right", marginTop: 3 },
  actionBody: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6 },
});

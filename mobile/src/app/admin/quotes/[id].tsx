import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { convertAdminQuote, emailAdminQuote, fetchAdminQuote, updateAdminQuoteStatus, type AdminQuoteDetail, type AdminQuoteStatus } from "@/admin/api";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function AdminQuoteDetailScreen() {
  return <AdminGate><QuoteDetail /></AdminGate>;
}

function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [quote, setQuote] = useState<AdminQuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try { setQuote(await fetchAdminQuote(request, id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load this quote."); }
    finally { setLoading(false); }
  }, [id, request]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const runStatus = (status: AdminQuoteStatus) => {
    const copy = status === "ACCEPTED"
      ? { title: "Mark quote accepted?", body: "Use this only after the customer has accepted the estimate." }
      : { title: "Cancel this quote?", body: "The estimate will remain in the record but cannot be converted while cancelled." };
    Alert.alert(copy.title, copy.body, [{ text: "Not now", style: "cancel" }, { text: "Continue", style: status === "CANCELLED" ? "destructive" : "default", onPress: () => void performStatus(status) }]);
  };

  const performStatus = async (status: AdminQuoteStatus) => {
    if (!id) return;
    setBusyAction(status); setError(""); setNotice("");
    try { setQuote(await updateAdminQuoteStatus(request, id, status)); setNotice(`Quote marked ${humanize(status).toLowerCase()}.`); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Unable to update this quote."); }
    finally { setBusyAction(""); }
  };

  const confirmEmail = () => {
    if (!quote) return;
    Alert.alert("Email quote to customer?", `A PDF copy will be sent to ${quote.customerEmail}.`, [{ text: "Not now", style: "cancel" }, { text: "Send quote", onPress: () => void performEmail() }]);
  };

  const performEmail = async () => {
    if (!id || !quote) return;
    setBusyAction("email"); setError(""); setNotice("");
    try { const result = await emailAdminQuote(request, id, quote.customerEmail); setNotice(`Quote emailed to ${result.toEmail}.`); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Unable to email this quote."); }
    finally { setBusyAction(""); }
  };

  const confirmConversion = () => {
    if (!quote) return;
    Alert.alert("Create booking from quote?", "This creates a real booking using the accepted trip, vehicle, customer, and price. It does not collect payment.", [{ text: "Not now", style: "cancel" }, { text: "Create booking", onPress: () => void performConversion() }]);
  };

  const performConversion = async () => {
    if (!id) return;
    setBusyAction("convert"); setError(""); setNotice("");
    try {
      const result = await convertAdminQuote(request, id);
      Alert.alert(result.alreadyConverted ? "Booking already exists" : "Booking created", result.alreadyConverted ? "This quote had already been converted." : "The reservation is ready for review.", [
        { text: "Stay here", style: "cancel", onPress: () => void load() },
        { text: "Open booking", onPress: () => router.replace(`/admin/bookings/${result.bookingId}` as Href) },
      ]);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Unable to convert this quote."); }
    finally { setBusyAction(""); }
  };

  const effectiveStatus = quote ? getEffectiveStatus(quote.status, quote.expiresAt) : "";
  const terminal = effectiveStatus === "CONVERTED";
  const reference = quote?.publicId || id?.slice(0, 8).toUpperCase() || "Quote";

  return (
    <AdminScreen back eyebrow="QUOTE DETAIL" title={reference} subtitle={quote ? `${quote.customerFullName} · ${formatJmdCents(quote.totalCents)}` : "Loading estimate details…"} refreshing={loading && Boolean(quote)} onRefresh={() => void load()}>
      {loading && !quote ? <AdminCard style={styles.loadingCard}><View style={styles.loadingLineLarge} /><View style={styles.loadingLine} /><View style={styles.loadingLineSmall} /></AdminCard> : null}
      {error ? <View style={styles.errorCard}><MaterialIcons name="error-outline" size={21} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
      {notice ? <View style={styles.noticeCard}><MaterialIcons name="check-circle" size={20} color={colors.success} /><Text style={styles.noticeText}>{notice}</Text></View> : null}

      {quote ? <>
        <AdminCard>
          <View style={styles.statusHeader}><View><Text style={styles.label}>QUOTE STATUS</Text><Text style={styles.statusTitle}>{humanize(effectiveStatus)}</Text></View><View style={styles.statusIcon}><MaterialIcons name={terminal ? "task-alt" : "request-quote"} size={25} color={terminal ? colors.success : colors.orange} /></View></View>
          <View style={styles.divider} />
          <DetailRow icon="date-range" label="Trip" value={`${dateOnly(quote.startAt)} → ${dateOnly(quote.endAt)}`} />
          <DetailRow icon="place" label="Pickup" value={quote.pickupLocationText} />
          <DetailRow icon="flag" label="Return" value={quote.dropoffLocationText} />
          <DetailRow icon="directions-car" label="Vehicle" value={[quote.vehicleLabel, quote.vehicleClass].filter(Boolean).join(" · ")} />
          {quote.expiresAt ? <DetailRow icon="schedule" label="Valid until" value={formatTimestamp(quote.expiresAt)} /> : null}
        </AdminCard>

        <AdminCard>
          <Text style={styles.sectionTitle}>Customer</Text>
          <DetailRow icon="person" label="Name" value={quote.customerFullName} />
          <DetailRow icon="mail" label="Email" value={quote.customerEmail} />
          <DetailRow icon="phone" label="Phone" value={quote.customerPhone || "Not recorded"} />
        </AdminCard>

        <AdminCard>
          <View style={styles.moneyHero}><View><Text style={styles.label}>ESTIMATE TOTAL</Text><Text style={styles.moneyValue}>{formatJmdCents(quote.totalCents)}</Text></View><View style={styles.depositBadge}><Text style={styles.depositBadgeText}>{formatJmdCents(quote.depositRequiredCents)} deposit</Text></View></View>
          <View style={styles.divider} />
          <InfoRow label="Base rental" value={formatJmdCents(quote.baseTotalCents)} />
          <InfoRow label="Insurance" value={formatJmdCents(quote.insuranceTotalCents)} />
          <InfoRow label="Discount" value={quote.discountTotalCents ? `−${formatJmdCents(quote.discountTotalCents)}` : formatJmdCents(0)} />
          <InfoRow label="Amount due" value={formatJmdCents(quote.amountDueCents)} />
          {quote.promoCode ? <InfoRow label="Promo code" value={quote.promoCode} /> : null}
        </AdminCard>

        {(quote.comments || quote.tags.length || quote.commissionPartnerName) ? <AdminCard><Text style={styles.sectionTitle}>Internal context</Text>{quote.comments ? <Text style={styles.notes}>{quote.comments}</Text> : null}{quote.tags.length ? <View style={styles.tagRow}>{quote.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}</View> : null}{quote.commissionPartnerName ? <InfoRow label="Commission partner" value={quote.commissionPartnerName} /> : null}</AdminCard> : null}

        <AdminCard>
          <Text style={styles.sectionTitle}>Quote actions</Text>
          <Text style={styles.actionBody}>Every action is confirmed before it changes customer or reservation data.</Text>
          {!terminal && effectiveStatus !== "EXPIRED" && effectiveStatus !== "CANCELLED" ? <AdminButton label={busyAction === "email" ? "Sending quote…" : quote.lastEmailedAt ? "Email quote again" : "Email quote to customer"} onPress={confirmEmail} disabled={Boolean(busyAction)} icon="send" /> : null}
          {effectiveStatus === "SENT" ? <AdminButton label={busyAction === "ACCEPTED" ? "Updating quote…" : "Mark as accepted"} onPress={() => runStatus("ACCEPTED")} disabled={Boolean(busyAction)} secondary icon="check-circle" /> : null}
          {effectiveStatus === "ACCEPTED" ? <AdminButton label={busyAction === "convert" ? "Creating booking…" : "Create booking from quote"} onPress={confirmConversion} disabled={Boolean(busyAction)} icon="event-available" /> : null}
          {!terminal && effectiveStatus !== "CANCELLED" ? <AdminButton label={busyAction === "CANCELLED" ? "Cancelling quote…" : "Cancel quote"} onPress={() => runStatus("CANCELLED")} disabled={Boolean(busyAction)} secondary icon="cancel" /> : null}
          {quote.convertedBookingId ? <AdminButton label="Open converted booking" onPress={() => router.push(`/admin/bookings/${quote.convertedBookingId}` as Href)} secondary icon="open-in-new" /> : null}
          {quote.lastEmailedAt ? <Text style={styles.auditText}>Last emailed {formatTimestamp(quote.lastEmailedAt)}{quote.lastEmailedTo ? ` to ${quote.lastEmailedTo}` : ""}</Text> : null}
        </AdminCard>
      </> : null}
    </AdminScreen>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) {
  const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.detailRow}><View style={styles.detailIcon}><MaterialIcons name={icon} size={18} color={colors.tealDark} /></View><View style={styles.detailCopy}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>;
}
function InfoRow({ label, value }: { label: string; value: string }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function getEffectiveStatus(status: string, expiresAt: string | null) { if (!["CONVERTED", "CANCELLED", "EXPIRED"].includes(status) && expiresAt && new Date(expiresAt).getTime() < Date.now()) return "EXPIRED"; return status; }
function humanize(value: string) { return String(value || "Not recorded").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function dateOnly(value: string) { return String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value); }
function formatTimestamp(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-JM", { dateStyle: "medium", timeStyle: "short" }).format(parsed); }
function formatJmdCents(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0) / 100); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  loadingCard: { gap: 12 }, loadingLineLarge: { width: "55%", height: 24, borderRadius: 7, backgroundColor: colors.surfaceSoft }, loadingLine: { width: "100%", height: 16, borderRadius: 6, backgroundColor: colors.surfaceSoft }, loadingLineSmall: { width: "72%", height: 16, borderRadius: 6, backgroundColor: colors.surfaceSoft },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 }, retry: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  noticeCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 13, borderRadius: radii.lg, backgroundColor: colors.cream }, noticeText: { flex: 1, color: colors.success, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  statusHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, label: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, statusTitle: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 5 }, statusIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 }, detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginTop: 13 }, detailIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, detailCopy: { flex: 1, paddingTop: 1 }, detailLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" }, detailValue: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "800", marginTop: 3 }, sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginBottom: 4 },
  moneyHero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, moneyValue: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4 }, depositBadge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.cream }, depositBadgeText: { color: colors.tealDark, fontSize: 9, fontWeight: "900" }, infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 7 }, infoLabel: { color: colors.muted, fontSize: 12 }, infoValue: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "right" },
  notes: { color: colors.text, fontSize: 12, lineHeight: 19, marginTop: 8 }, tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginVertical: 12 }, tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceSoft }, tagText: { color: colors.tealDark, fontSize: 10, fontWeight: "800" }, actionBody: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6 }, auditText: { color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 13 },
});

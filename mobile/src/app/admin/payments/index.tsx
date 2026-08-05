import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import {
  fetchAdminPayments,
  recordAdminRefundAdjustment,
  updateAdminPayment,
  type AdminPaymentItem,
} from "@/admin/api";
import { hasCapability } from "@/admin/capabilities";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

type PaymentAction = "delete" | "restore" | "refund";

const STATE_FILTERS = [
  { key: "all", label: "All" },
  { key: "successful", label: "Successful" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "refunded", label: "Refunded" },
  { key: "deleted", label: "Cancelled" },
] as const;

const TYPE_FILTERS = [
  { key: "all", label: "All types" },
  { key: "deposit", label: "Deposit" },
  { key: "balance", label: "Balance" },
  { key: "refund", label: "Refund" },
] as const;

const PROVIDERS = ["all", "WIPAY", "MANUAL"] as const;

export default function AdminPaymentsScreen() {
  return <AdminGate><PaymentsWorkspace /></AdminGate>;
}

function PaymentsWorkspace() {
  const { request, user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "payments.read"));
  const canWrite = Boolean(user && hasCapability(user.role, "payments.write"));
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [type, setType] = useState("all");
  const [provider, setProvider] = useState("all");
  const [items, setItems] = useState<AdminPaymentItem[]>([]);
  const [summary, setSummary] = useState({ total_count: 0, collected_amount: 0, refund_amount: 0, net_amount: 0, successful_count: 0, attention_count: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [requireRestoreReason, setRequireRestoreReason] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ item: AdminPaymentItem; action: PaymentAction } | null>(null);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async (cursor: string | null = null) => {
    if (!allowed) return;
    if (cursor) setLoadingMore(true); else setLoading(true);
    if (!cursor) setError("");
    try {
      const page = await fetchAdminPayments(request, { q: query, type, state, provider, cursor, limit: 20 });
      setItems((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items);
      setSummary(page.summary);
      setTotalCount(page.totalCount);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setRequireRestoreReason(page.requireRestoreReason);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load payment activity.");
      if (!cursor) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [allowed, provider, query, request, state, type]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const beginAction = (item: AdminPaymentItem, action: PaymentAction) => {
    setPending({ item, action });
    setReason("");
    setError("");
    setNotice("");
  };

  const submitAction = () => {
    if (!pending) return;
    if (!reason.trim() && (pending.action !== "restore" || requireRestoreReason)) {
      setError("A reason is required for this accounting action.");
      return;
    }
    Alert.alert(actionTitle(pending.action), actionConfirmation(pending.action), [
      { text: "Review again", style: "cancel" },
      { text: actionButton(pending.action), style: pending.action === "delete" ? "destructive" : "default", onPress: () => void performAction() },
    ]);
  };

  const performAction = async () => {
    if (!pending) return;
    setActing(true);
    setError("");
    try {
      if (pending.action === "refund") await recordAdminRefundAdjustment(request, pending.item.id, reason.trim());
      else await updateAdminPayment(request, pending.item.id, pending.action, reason.trim());
      setNotice(pending.action === "refund" ? "Manual refund adjustment recorded. Confirm external WiPay refund status separately." : pending.action === "delete" ? "Manual payment cancelled and booking totals recalculated." : "Manual payment restored and booking totals recalculated.");
      setPending(null);
      setReason("");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update this payment.");
    } finally {
      setActing(false);
    }
  };

  if (!allowed) return <AdminScreen back title="Workspace unavailable" subtitle="Payment administration requires an administrator role." />;

  const activeFilters = Boolean(query || state !== "all" || type !== "all" || provider !== "all");
  return (
    <AdminScreen back eyebrow="FINANCE" title="Payments" subtitle="Review collections, triage provider exceptions, and protect booking balances." refreshing={loading && items.length > 0} onRefresh={() => void load()}>
      <View style={styles.searchRow}><View style={styles.search}><MaterialIcons name="search" size={20} color={colors.muted} /><TextInput value={queryInput} onChangeText={setQueryInput} onSubmitEditing={() => setQuery(queryInput.trim())} placeholder="Payment, booking, customer, provider ref" placeholderTextColor={colors.muted} style={styles.searchInput} autoCapitalize="none" returnKeyType="search" /></View><Pressable onPress={() => setQuery(queryInput.trim())} style={styles.searchButton}><MaterialIcons name="arrow-forward" size={21} color={colors.white} /></Pressable></View>

      <View style={styles.metrics}><Metric icon="account-balance-wallet" label="NET" value={money(summary.net_amount)} /><Metric icon="payments" label="COLLECTED" value={money(summary.collected_amount)} /><Metric icon="undo" label="ADJUSTMENTS" value={money(summary.refund_amount)} /><Metric icon="warning-amber" label="ATTENTION" value={String(summary.attention_count)} /></View>

      <View><Text style={styles.filterLabel}>TRANSACTION STATE</Text><View style={styles.filters}>{STATE_FILTERS.map((item) => <Pressable key={item.key} onPress={() => setState(item.key)} style={[styles.filter, state === item.key && styles.filterActive]}><Text style={[styles.filterText, state === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View></View>
      <View><Text style={styles.filterLabel}>TYPE</Text><View style={styles.filters}>{TYPE_FILTERS.map((item) => <Pressable key={item.key} onPress={() => setType(item.key)} style={[styles.filter, type === item.key && styles.filterActive]}><Text style={[styles.filterText, type === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View></View>
      <View><Text style={styles.filterLabel}>PROVIDER</Text><View style={styles.filters}>{PROVIDERS.map((item) => <Pressable key={item} onPress={() => setProvider(item)} style={[styles.filter, provider === item && styles.filterActive]}><Text style={[styles.filterText, provider === item && styles.filterTextActive]}>{item === "all" ? "All providers" : item}</Text></Pressable>)}</View></View>

      <View style={styles.resultHeader}><View><Text style={styles.resultTitle}>{loading && !items.length ? "Loading transactions…" : `${totalCount} ${totalCount === 1 ? "transaction" : "transactions"}`}</Text><Text style={styles.resultMeta}>{loading && items.length ? "Updating filtered totals…" : "Metrics reflect the active filters"}</Text></View>{activeFilters ? <Pressable onPress={() => { setQueryInput(""); setQuery(""); setState("all"); setType("all"); setProvider("all"); }}><Text style={styles.clear}>Clear filters</Text></Pressable> : null}</View>
      {notice ? <View style={styles.notice}><MaterialIcons name="check-circle" size={20} color={colors.success} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
      {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}

      {!loading && !error && !items.length ? <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="receipt-long" size={27} color={colors.orange} /></View><Text style={styles.emptyTitle}>No transactions match</Text><Text style={styles.emptyBody}>Try a broader state, provider, type, or search term.</Text></View> : null}
      <View style={styles.list}>{items.map((item) => <View key={item.id} style={styles.itemGroup}><PaymentCard item={item} canWrite={canWrite} onAction={beginAction} />{pending?.item.id === item.id ? <ActionPanel pending={pending} reason={reason} setReason={setReason} requireRestoreReason={requireRestoreReason} acting={acting} onSubmit={submitAction} onCancel={() => { setPending(null); setReason(""); }} /> : null}</View>)}</View>
      {hasMore && nextCursor ? <AdminButton label={loadingMore ? "Loading transactions…" : "Load more transactions"} onPress={() => void load(nextCursor)} disabled={loadingMore} secondary /> : null}
      <AdminCard style={styles.disclaimer}><View style={styles.disclaimerRow}><MaterialIcons name="info-outline" size={20} color={colors.tealDark} /><View style={styles.disclaimerCopy}><Text style={styles.disclaimerTitle}>Accounting record vs. provider settlement</Text><Text style={styles.disclaimerText}>A refund adjustment updates Curated’s ledger and booking balance. It does not call WiPay or prove money was returned externally.</Text></View></View></AdminCard>
    </AdminScreen>
  );
}

function Metric({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.metric}><MaterialIcons name={icon} size={18} color={colors.tealDark} /><Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function PaymentCard({ item, canWrite, onAction }: { item: AdminPaymentItem; canWrite: boolean; onAction: (item: AdminPaymentItem, action: PaymentAction) => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const deleted = Boolean(item.deletedAt);
  const failed = Boolean(item.error) || ["FAILED", "ERROR", "DECLINED"].includes(item.status.toUpperCase());
  const canManual = canWrite && item.provider === "MANUAL";
  const canRefund = canWrite && item.provider === "WIPAY" && item.status.toUpperCase() === "DEPOSIT_PAID" && item.amount > 0 && !item.isRefunded && !deleted;
  return <View style={[styles.card, deleted && styles.cardDeleted, failed && styles.cardFailed]}><View style={styles.cardTop}><View><Text style={styles.paymentId}>{item.publicId}</Text><Text style={styles.created}>{formatDateTime(item.createdAt)}</Text></View><View style={[styles.statusBadge, failed && styles.statusBadgeFailed, deleted && styles.statusBadgeDeleted]}><Text style={[styles.statusText, failed && styles.statusTextFailed, deleted && styles.statusTextDeleted]}>{deleted ? "Cancelled" : item.statusLabel}</Text></View></View><Text style={styles.amount}>{money(item.amount)}</Text><Text style={styles.type}>{humanize(item.paymentType)} · {item.providerLabel}</Text><View style={styles.party}><Text style={styles.customer}>{item.customerName}</Text><Text style={styles.email}>{item.customerEmail}</Text><Text style={styles.vehicle}>{item.vehicleLabel}</Text></View><View style={styles.refs}><RefRow label="Booking" value={item.bookingPublicId || item.bookingId.slice(0, 8).toUpperCase()} /><RefRow label="Provider ref" value={item.providerReference || "Not assigned"} />{item.transactionId ? <RefRow label="Transaction" value={item.transactionId} /> : null}</View>{item.error ? <View style={styles.providerError}><MaterialIcons name="cloud-off" size={18} color={colors.danger} /><View style={styles.providerErrorCopy}><Text style={styles.providerErrorTitle}>{item.error.title}</Text><Text style={styles.providerErrorDetail}>{item.error.detail}</Text></View></View> : null}{deleted && item.deletedReason ? <View style={styles.deletedReason}><Text style={styles.deletedReasonLabel}>CANCELLATION REASON</Text><Text style={styles.deletedReasonText}>{item.deletedReason}</Text></View> : null}<Pressable onPress={() => router.push(`/admin/bookings/${item.bookingId}` as Href)} style={styles.openBooking}><Text style={styles.openBookingText}>Open booking</Text><MaterialIcons name="chevron-right" size={21} color={colors.orange} /></Pressable>{canManual || canRefund ? <View style={styles.actions}>{canManual ? <Pressable onPress={() => onAction(item, deleted ? "restore" : "delete")} style={styles.actionButton}><MaterialIcons name={deleted ? "restore" : "cancel"} size={17} color={deleted ? colors.tealDark : colors.danger} /><Text style={[styles.actionText, !deleted && { color: colors.danger }]}>{deleted ? "Restore manual payment" : "Cancel manual payment"}</Text></Pressable> : null}{canRefund ? <Pressable onPress={() => onAction(item, "refund")} style={styles.actionButton}><MaterialIcons name="undo" size={17} color={colors.tealDark} /><Text style={styles.actionText}>Record refund adjustment</Text></Pressable> : null}</View> : null}{item.isRefunded ? <View style={styles.refunded}><MaterialIcons name="check" size={15} color={colors.success} /><Text style={styles.refundedText}>Refund adjustment already recorded</Text></View> : null}</View>;
}

function ActionPanel({ pending, reason, setReason, requireRestoreReason, acting, onSubmit, onCancel }: { pending: { item: AdminPaymentItem; action: PaymentAction }; reason: string; setReason: (value: string) => void; requireRestoreReason: boolean; acting: boolean; onSubmit: () => void; onCancel: () => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const required = pending.action !== "restore" || requireRestoreReason;
  return <AdminCard style={styles.actionPanel}><View style={styles.actionPanelHeader}><View style={styles.actionPanelIcon}><MaterialIcons name={pending.action === "refund" ? "undo" : pending.action === "restore" ? "restore" : "warning-amber"} size={22} color={colors.orangeDark} /></View><View style={styles.actionPanelCopy}><Text style={styles.actionPanelTitle}>{actionTitle(pending.action)}</Text><Text style={styles.actionPanelBody}>{actionBody(pending.action)}</Text></View></View><Text style={styles.reasonLabel}>REASON {required ? "*" : "(OPTIONAL)"}</Text><TextInput value={reason} onChangeText={setReason} multiline placeholder="Record the business reason for the audit trail" placeholderTextColor={colors.muted} style={styles.reasonInput} /><AdminButton label={acting ? "Updating payment…" : actionButton(pending.action)} onPress={onSubmit} disabled={acting} icon={pending.action === "refund" ? "undo" : "verified-user"} /><AdminButton label="Cancel" onPress={onCancel} disabled={acting} secondary /></AdminCard>;
}

function RefRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.refRow}><Text style={styles.refLabel}>{label}</Text><Text style={styles.refValue} numberOfLines={1}>{value}</Text></View>;
}

function actionTitle(action: PaymentAction) { return action === "delete" ? "Cancel manual payment" : action === "restore" ? "Restore manual payment" : "Record refund adjustment"; }
function actionBody(action: PaymentAction) { return action === "delete" ? "This removes the payment from active totals and may change the booking’s balance or status." : action === "restore" ? "This returns the payment to active totals and may re-entitle the booking." : "This records a negative ledger adjustment. It does not send money through WiPay."; }
function actionConfirmation(action: PaymentAction) { return action === "delete" ? "Booking totals and possibly status will be recalculated immediately." : action === "restore" ? "Booking totals and availability entitlement will be recalculated immediately." : "Confirm the external refund separately. This action only records the accounting adjustment."; }
function actionButton(action: PaymentAction) { return action === "delete" ? "Cancel payment" : action === "restore" ? "Restore payment" : "Record adjustment"; }
function money(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Number(value) || 0); }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-JM", { dateStyle: "medium", timeStyle: "short" }); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 9 },
  search: { flex: 1, minHeight: 50, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 12 },
  searchButton: { width: 50, height: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", minHeight: 91, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricValue: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 7 },
  metricLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", marginTop: 3 },
  filterLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginBottom: 7 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  filterTextActive: { color: colors.white },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  resultMeta: { color: colors.muted, fontSize: 8, marginTop: 3 },
  clear: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  notice: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.cream },
  noticeText: { flex: 1, color: colors.success, fontSize: 11, lineHeight: 17, fontWeight: "800" },
  error: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  errorText: { flex: 1, color: colors.danger, fontSize: 11, lineHeight: 16 },
  retry: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  empty: { alignItems: "center", padding: 26, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 55, height: 55, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, marginTop: 5, textAlign: "center" },
  list: { gap: 10 },
  itemGroup: { gap: 8 },
  card: { padding: 15, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardDeleted: { opacity: 0.78, borderColor: colors.muted },
  cardFailed: { borderColor: colors.danger },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  paymentId: { color: colors.orange, fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  created: { color: colors.muted, fontSize: 9, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.cream },
  statusBadgeFailed: { backgroundColor: colors.surfaceSoft },
  statusBadgeDeleted: { backgroundColor: colors.surfaceSoft },
  statusText: { color: colors.success, fontSize: 8, fontWeight: "900" },
  statusTextFailed: { color: colors.danger },
  statusTextDeleted: { color: colors.muted },
  amount: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 13 },
  type: { color: colors.tealDark, fontSize: 10, fontWeight: "800", marginTop: 2 },
  party: { marginTop: 13 },
  customer: { color: colors.text, fontSize: 14, fontWeight: "900" },
  email: { color: colors.muted, fontSize: 9, marginTop: 3 },
  vehicle: { color: colors.muted, fontSize: 10, fontWeight: "700", marginTop: 5 },
  refs: { marginTop: 12, padding: 10, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  refRow: { flexDirection: "row", gap: 10, justifyContent: "space-between", paddingVertical: 4 },
  refLabel: { color: colors.muted, fontSize: 9 },
  refValue: { flex: 1, color: colors.text, fontSize: 9, fontWeight: "800", textAlign: "right" },
  providerError: { flexDirection: "row", gap: 8, padding: 10, marginTop: 10, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  providerErrorCopy: { flex: 1 },
  providerErrorTitle: { color: colors.danger, fontSize: 10, fontWeight: "900" },
  providerErrorDetail: { color: colors.muted, fontSize: 9, marginTop: 3 },
  deletedReason: { padding: 10, marginTop: 10, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  deletedReasonLabel: { color: colors.muted, fontSize: 7, fontWeight: "900", letterSpacing: 1 },
  deletedReasonText: { color: colors.text, fontSize: 10, lineHeight: 15, marginTop: 4 },
  openBooking: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  openBookingText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  actions: { gap: 7, marginTop: 10 },
  actionButton: { minHeight: 42, paddingHorizontal: 12, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  actionText: { color: colors.tealDark, fontSize: 9, fontWeight: "900" },
  refunded: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10 },
  refundedText: { color: colors.success, fontSize: 9, fontWeight: "800" },
  actionPanel: { borderColor: colors.orange },
  actionPanelHeader: { flexDirection: "row", gap: 10 },
  actionPanelIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  actionPanelCopy: { flex: 1 },
  actionPanelTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  actionPanelBody: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  reasonLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 14 },
  reasonInput: { minHeight: 88, padding: 12, marginTop: 7, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 11, textAlignVertical: "top" },
  disclaimer: { borderColor: colors.teal },
  disclaimerRow: { flexDirection: "row", gap: 9 },
  disclaimerCopy: { flex: 1 },
  disclaimerTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  disclaimerText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
});

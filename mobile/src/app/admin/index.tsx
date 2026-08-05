import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { modulesForRole, type AdminModule } from "@/admin/capabilities";
import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminDashboard, type AdminDashboardData } from "@/admin/api";
import { AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function AdminDashboardScreen() {
  return <AdminGate><AdminDashboard /></AdminGate>;
}

function AdminDashboard() {
  const { user, signOut, request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await fetchAdminDashboard(request));
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : "Unable to refresh the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const task = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(task);
  }, [refresh]);

  if (!user) return null;

  const modules = modulesForRole(user.role);
  const firstName = user.fullName?.trim().split(/\s+/)[0] || user.username || "there";
  const grouped = {
    work: modules.filter((item) => item.group === "work"),
    business: modules.filter((item) => item.group === "business"),
    system: modules.filter((item) => item.group === "system"),
  };

  return (
    <AdminScreen
      eyebrow="STAFF WORKSPACE"
      title={`Good day, ${firstName}`}
      subtitle="Your mobile command centre for today’s rentals and customer care."
      action={<Pressable onPress={() => void signOut()} style={styles.signOut} accessibilityRole="button" accessibilityLabel="Sign out"><MaterialIcons name="logout" size={20} color={colors.white} /></Pressable>}
      refreshing={loading && Boolean(dashboard)}
      onRefresh={() => void refresh()}
    >
      <View style={styles.identityRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{firstName.slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.identityCopy}><Text style={styles.identityName}>{user.fullName || user.username || user.email}</Text><Text style={styles.identityEmail}>{user.email}</Text></View>
        <View style={styles.roleBadge}><Text style={styles.roleText}>{user.role}</Text></View>
      </View>

      {error ? <View style={styles.errorCard}><MaterialIcons name="cloud-off" size={20} color={colors.danger} /><View style={styles.errorCopy}><Text style={styles.errorTitle}>Dashboard update failed</Text><Text style={styles.errorBody}>{error}</Text></View><Pressable onPress={() => void refresh()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}

      <View style={styles.metricGrid}>
        <MetricCard label="Bookings" value={dashboard?.metrics.totalBookings} icon="event-note" loading={loading && !dashboard} />
        <MetricCard label="Pending payment" value={dashboard?.metrics.pendingPayment} icon="hourglass-top" tone="warning" loading={loading && !dashboard} />
        <MetricCard label="Confirmed" value={dashboard?.metrics.confirmedBookings} icon="event-available" tone="success" loading={loading && !dashboard} />
        <MetricCard label="Vehicles ready" value={dashboard ? `${dashboard.metrics.availableVehicles}/${dashboard.metrics.totalVehicles}` : undefined} icon="directions-car" loading={loading && !dashboard} />
      </View>

      <AdminCard style={styles.focusCard}>
        <View style={styles.focusHeader}><View><Text style={styles.sectionEyebrow}>TODAY</Text><Text style={styles.focusTitle}>Start with what needs attention</Text></View><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
        <Text style={styles.focusBody}>Jump directly into the customer and rental workspaces you use most throughout the day.</Text>
        <View style={styles.quickRow}>
          {grouped.work.slice(0, 3).map((module) => <QuickAction key={module.key} module={module} />)}
        </View>
      </AdminCard>

      {dashboard?.recentBookings.length ? (
        <View style={styles.section}>
          <View style={styles.listHeader}><View><Text style={styles.sectionTitle}>Recent bookings</Text><Text style={styles.sectionDescription}>Latest reservation activity from the live system.</Text></View><Pressable onPress={() => router.push("/admin/bookings" as Href)}><Text style={styles.seeAll}>See all</Text></Pressable></View>
          <View style={styles.moduleGrid}>{dashboard.recentBookings.map((booking) => <Pressable key={booking.id} onPress={() => router.push("/admin/bookings" as Href)} style={styles.bookingCard}><View style={styles.bookingTop}><Text style={styles.bookingId}>{booking.publicId}</Text><View style={styles.statusBadge}><Text style={styles.statusText}>{booking.statusLabel}</Text></View></View><Text style={styles.bookingCustomer}>{booking.customerName}</Text><Text style={styles.bookingMeta}>{booking.vehicleLabel}</Text><View style={styles.bookingDates}><MaterialIcons name="date-range" size={15} color={colors.muted} /><Text style={styles.bookingMeta}>{booking.startDateIso} → {booking.endDateIso}</Text></View>{booking.substatusIndicators[0] ? <Text style={styles.substatus}>{booking.substatusIndicators[0].message}</Text> : null}</Pressable>)}</View>
        </View>
      ) : null}

      <ModuleSection title="Work" description="High-frequency customer and rental operations." modules={grouped.work} />
      {grouped.business.length ? <ModuleSection title="Business" description="Fleet health, money, and performance." modules={grouped.business} /> : null}
      {grouped.system.length ? <ModuleSection title="System" description="Administration, records, and controls." modules={grouped.system} /> : null}
      <Text style={styles.securityFootnote}>Access is limited by your staff role. Every action is re-authorized by the server.</Text>
    </AdminScreen>
  );
}

function MetricCard({ label, value, icon, tone = "default", loading }: { label: string; value: string | number | undefined; icon: React.ComponentProps<typeof MaterialIcons>["name"]; tone?: "default" | "warning" | "success"; loading?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const iconColor = tone === "warning" ? colors.orange : tone === "success" ? colors.success : colors.tealDark;
  return <View style={styles.metricCard}><View style={styles.metricTop}><View style={[styles.metricIcon, tone === "warning" && styles.metricIconWarning]}><MaterialIcons name={icon} size={19} color={iconColor} /></View>{loading ? <View style={styles.metricSkeleton} /> : <Text style={styles.metricValue}>{value ?? "—"}</Text>}</View><Text style={styles.metricLabel}>{label}</Text></View>;
}

function QuickAction({ module }: { module: AdminModule }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Pressable onPress={() => router.push(module.href as Href)} style={styles.quickAction}><MaterialIcons name={module.icon as React.ComponentProps<typeof MaterialIcons>["name"]} size={22} color={colors.orange} /><Text style={styles.quickText}>{module.title}</Text></Pressable>;
}

function ModuleSection({ title, description, modules }: { title: string; description: string; modules: readonly AdminModule[] }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionDescription}>{description}</Text><View style={styles.moduleGrid}>{modules.map((module) => <Pressable key={module.key} onPress={() => router.push(module.href as Href)} style={styles.moduleCard}><View style={styles.moduleIcon}><MaterialIcons name={module.icon as React.ComponentProps<typeof MaterialIcons>["name"]} size={22} color={colors.tealDark} /></View><View style={styles.moduleCopy}><Text style={styles.moduleTitle}>{module.title}</Text><Text style={styles.moduleDescription} numberOfLines={2}>{module.description}</Text></View><MaterialIcons name="chevron-right" size={23} color={colors.muted} /></Pressable>)}</View></View>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  signOut: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  identityRow: { minHeight: 74, borderRadius: radii.lg, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.white, fontSize: 18, fontWeight: "900" },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  identityEmail: { color: colors.muted, fontSize: 11, marginTop: 3 },
  roleBadge: { backgroundColor: colors.cream, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  roleText: { color: colors.tealDark, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radii.lg, padding: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  errorBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  retry: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.cream },
  retryText: { color: colors.tealDark, fontSize: 11, fontWeight: "900" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metricCard: { width: "48.5%", minHeight: 110, borderRadius: radii.lg, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricIcon: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  metricIconWarning: { backgroundColor: colors.surfaceSoft },
  metricValue: { color: colors.text, fontSize: 25, fontWeight: "900" },
  metricSkeleton: { width: 38, height: 24, borderRadius: 7, backgroundColor: colors.surfaceSoft },
  metricLabel: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 14 },
  focusCard: { backgroundColor: colors.navySoft, borderColor: colors.navySoft },
  focusHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start", justifyContent: "space-between" },
  sectionEyebrow: { color: colors.orange, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 7 },
  focusTitle: { maxWidth: 245, color: colors.white, fontSize: 21, lineHeight: 27, fontWeight: "900" },
  focusBody: { color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 20, marginTop: 10 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  liveText: { color: colors.white, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  quickRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  quickAction: { flex: 1, minHeight: 74, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: radii.md, padding: 10, justifyContent: "space-between" },
  quickText: { color: colors.white, fontSize: 11, fontWeight: "800", marginTop: 8 },
  section: { marginTop: 10 },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  sectionDescription: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 3, marginBottom: 11 },
  moduleGrid: { gap: 9 },
  listHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  seeAll: { color: colors.tealDark, fontSize: 12, fontWeight: "900", paddingTop: 5 },
  bookingCard: { padding: 15, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  bookingTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bookingId: { color: colors.orange, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.cream },
  statusText: { color: colors.tealDark, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  bookingCustomer: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 10 },
  bookingMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  bookingDates: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  substatus: { color: colors.orangeDark, fontSize: 10, lineHeight: 15, fontWeight: "800", marginTop: 8 },
  moduleCard: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  moduleIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  moduleCopy: { flex: 1, minWidth: 0 },
  moduleTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  moduleDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  securityFootnote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 22, paddingVertical: 12 },
});

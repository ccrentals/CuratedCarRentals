import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { fetchAdminCalendar, type AdminCalendarPayload } from "@/admin/api";
import { AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

type CalendarView = "week" | "month";
type CalendarEvent = {
  key: string;
  date: string;
  kind: "pickup" | "return" | "blockout";
  title: string;
  subtitle: string;
  status: string;
  bookingId?: string;
  vehicleId: string;
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_payment", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "returned", label: "Returned" },
] as const;

export default function AdminCalendarScreen() {
  return <AdminGate><CalendarWorkspace /></AdminGate>;
}

function CalendarWorkspace() {
  const { request } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState<CalendarView>("week");
  const [baseDate, setBaseDate] = useState(todayKey());
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [vehiclePicker, setVehiclePicker] = useState(false);
  const [payload, setPayload] = useState<AdminCalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchAdminCalendar(request, { date: baseDate, view, vehicleId, status });
      setPayload(next);
      setSelectedDate((current) => next.days.includes(current) ? current : next.baseDate);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the operational calendar.");
    } finally {
      setLoading(false);
    }
  }, [baseDate, request, status, vehicleId, view]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const events = useMemo(() => payload ? buildEvents(payload) : [], [payload]);
  const eventsByDay = useMemo(() => {
    const result = new Map<string, CalendarEvent[]>();
    for (const event of events) result.set(event.date, [...(result.get(event.date) ?? []), event]);
    return result;
  }, [events]);
  const selectedEvents = eventsByDay.get(selectedDate) ?? [];
  const selectedVehicle = payload?.vehicles.find((vehicle) => vehicle.id === vehicleId);
  const movementCount = events.filter((event) => event.kind !== "blockout").length;
  const blockedDays = new Set(events.filter((event) => event.kind === "blockout").map((event) => event.date)).size;

  const move = (direction: -1 | 1) => {
    const next = shiftPeriod(baseDate, view, direction);
    setBaseDate(next);
    setSelectedDate(next);
  };

  const changeView = (nextView: CalendarView) => {
    setView(nextView);
    setBaseDate(selectedDate);
  };

  return (
    <AdminScreen back eyebrow="OPERATIONS" title="Calendar" subtitle="Coordinate pickups, returns, vehicle availability, and operational blockouts." refreshing={loading && Boolean(payload)} onRefresh={() => void load()}>
      <View style={styles.viewRow}>
        {(["week", "month"] as const).map((item) => <Pressable key={item} onPress={() => changeView(item)} style={[styles.viewChip, view === item && styles.viewChipActive]}><Text style={[styles.viewText, view === item && styles.viewTextActive]}>{item === "week" ? "Week" : "Month"}</Text></Pressable>)}
        <Pressable onPress={() => { const today = todayKey(); setBaseDate(today); setSelectedDate(today); }} style={styles.today}><MaterialIcons name="today" size={17} color={colors.tealDark} /><Text style={styles.todayText}>Today</Text></Pressable>
      </View>

      <AdminCard style={styles.navigator}>
        <Pressable onPress={() => move(-1)} style={styles.navButton} accessibilityLabel={`Previous ${view}`}><MaterialIcons name="chevron-left" size={25} color={colors.tealDark} /></Pressable>
        <View style={styles.navCopy}><Text style={styles.navEyebrow}>{view.toUpperCase()} VIEW</Text><Text style={styles.navTitle}>{periodLabel(baseDate, view)}</Text>{payload ? <Text style={styles.navRange}>{shortDate(payload.rangeStart)} – {shortDate(payload.rangeEnd)}</Text> : null}</View>
        <Pressable onPress={() => move(1)} style={styles.navButton} accessibilityLabel={`Next ${view}`}><MaterialIcons name="chevron-right" size={25} color={colors.tealDark} /></Pressable>
      </AdminCard>

      <Pressable onPress={() => setVehiclePicker((current) => !current)} style={styles.vehicleFilter}><View style={styles.vehicleFilterIcon}><MaterialIcons name="directions-car" size={19} color={colors.tealDark} /></View><View style={styles.vehicleFilterCopy}><Text style={styles.vehicleFilterLabel}>VEHICLE</Text><Text style={styles.vehicleFilterValue}>{selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}` : "All active vehicles"}</Text></View><MaterialIcons name={vehiclePicker ? "expand-less" : "expand-more"} size={22} color={colors.muted} /></Pressable>
      {vehiclePicker && payload ? <View style={styles.vehicleOptions}><Pressable onPress={() => { setVehicleId(null); setVehiclePicker(false); }} style={[styles.vehicleOption, !vehicleId && styles.vehicleOptionActive]}><Text style={styles.vehicleOptionText}>All active vehicles</Text></Pressable>{payload.vehicles.map((vehicle) => <Pressable key={vehicle.id} onPress={() => { setVehicleId(vehicle.id); setVehiclePicker(false); }} style={[styles.vehicleOption, vehicleId === vehicle.id && styles.vehicleOptionActive]}><Text style={styles.vehicleOptionText}>{vehicle.make} {vehicle.model}</Text></Pressable>)}</View> : null}

      <View style={styles.filters}>{STATUS_FILTERS.map((item) => <Pressable key={item.key} onPress={() => setStatus(item.key)} style={[styles.filter, status === item.key && styles.filterActive]}><Text style={[styles.filterText, status === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>

      {payload ? <View style={styles.metrics}><Metric icon="flight-takeoff" value={String(payload.bookings.length)} label="TRIPS" /><Metric icon="swap-vert" value={String(movementCount)} label="MOVEMENTS" /><Metric icon="block" value={String(blockedDays)} label="BLOCKED DAYS" /></View> : null}
      {payload?.warnings.map((warning) => <View key={warning} style={styles.warning}><MaterialIcons name="warning-amber" size={18} color={colors.orangeDark} /><Text style={styles.warningText}>{warning}</Text></View>)}
      {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}

      {!payload && loading ? <AdminCard><View style={styles.loading}><ActivityIndicator color={colors.orange} /><Text style={styles.loadingText}>Building the operational calendar…</Text></View></AdminCard> : null}
      {payload ? <>
        <AdminCard style={styles.calendarCard}>
          <View style={styles.weekLabels}>{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekLabel}>{day}</Text>)}</View>
          <View style={styles.dayGrid}>{payload.days.map((day) => <DayCell key={day} day={day} active={day === selectedDate} muted={view === "month" && day.slice(5, 7) !== baseDate.slice(5, 7)} events={eventsByDay.get(day) ?? []} onPress={() => setSelectedDate(day)} />)}</View>
        </AdminCard>

        <View style={styles.agendaHeader}><View><Text style={styles.agendaEyebrow}>DAILY AGENDA</Text><Text style={styles.agendaTitle}>{longDate(selectedDate)}</Text></View><View style={styles.countBadge}><Text style={styles.countText}>{selectedEvents.length}</Text></View></View>
        {selectedEvents.length ? <View style={styles.agenda}>{selectedEvents.map((event) => <EventCard key={event.key} event={event} />)}</View> : <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="event-available" size={27} color={colors.orange} /></View><Text style={styles.emptyTitle}>No movements scheduled</Text><Text style={styles.emptyBody}>This date has no matching pickups, returns, or blockouts.</Text></View>}
      </> : null}
    </AdminScreen>
  );
}

function Metric({ icon, value, label }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.metric}><MaterialIcons name={icon} size={18} color={colors.tealDark} /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function DayCell({ day, active, muted, events, onPress }: { day: string; active: boolean; muted: boolean; events: CalendarEvent[]; onPress: () => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasBlockout = events.some((event) => event.kind === "blockout");
  const hasMovement = events.some((event) => event.kind !== "blockout");
  return <Pressable onPress={onPress} style={[styles.day, active && styles.dayActive]}><Text style={[styles.dayText, muted && styles.dayMuted, active && styles.dayTextActive]}>{Number(day.slice(-2))}</Text><View style={styles.dots}>{hasMovement ? <View style={[styles.dot, active && styles.dotActive]} /> : null}{hasBlockout ? <View style={[styles.dot, styles.dotBlocked]} /> : null}</View></Pressable>;
}

function EventCard({ event }: { event: CalendarEvent }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const icon = event.kind === "pickup" ? "flight-takeoff" : event.kind === "return" ? "flight-land" : "block";
  const card = <View style={styles.event}><View style={[styles.eventIcon, event.kind === "blockout" && styles.eventIconBlocked]}><MaterialIcons name={icon} size={20} color={event.kind === "blockout" ? colors.orangeDark : colors.tealDark} /></View><View style={styles.eventCopy}><View style={styles.eventTitleRow}><Text style={styles.eventKind}>{event.kind.toUpperCase()}</Text><Text style={styles.eventStatus}>{humanize(event.status)}</Text></View><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.eventSubtitle}>{event.subtitle}</Text></View>{event.bookingId ? <MaterialIcons name="chevron-right" size={21} color={colors.orange} /> : null}</View>;
  return event.bookingId ? <Pressable onPress={() => router.push(`/admin/bookings/${event.bookingId}` as Href)}>{card}</Pressable> : card;
}

function buildEvents(payload: AdminCalendarPayload) {
  const events: CalendarEvent[] = [];
  for (const booking of payload.bookings) {
    const vehicle = `${booking.vehicle_make} ${booking.vehicle_model}`;
    events.push({ key: `${booking.id}-pickup`, date: booking.start_date.slice(0, 10), kind: "pickup", title: booking.customer_name, subtitle: `${vehicle} · ${booking.public_id || booking.id.slice(0, 8).toUpperCase()} · ${booking.pickup_location}`, status: booking.status, bookingId: booking.id, vehicleId: booking.vehicle_id });
    events.push({ key: `${booking.id}-return`, date: booking.end_date.slice(0, 10), kind: "return", title: booking.customer_name, subtitle: `${vehicle} · ${booking.public_id || booking.id.slice(0, 8).toUpperCase()}`, status: booking.status, bookingId: booking.id, vehicleId: booking.vehicle_id });
  }
  for (const blockout of payload.blockouts) {
    const start = jamaicaDateKey(blockout.start_at);
    const endTime = new Date(blockout.end_at).getTime();
    const end = jamaicaDateKey(Number.isNaN(endTime) ? blockout.end_at : new Date(endTime - 1).toISOString());
    for (const day of payload.days) {
      if (day < start || day > end) continue;
      events.push({ key: `${blockout.id}-${day}`, date: day, kind: "blockout", title: blockout.reason, subtitle: `${blockout.vehicle_make} ${blockout.vehicle_model}${blockout.notes ? ` · ${blockout.notes}` : ""}`, status: "unavailable", vehicleId: blockout.vehicle_id });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

function todayKey() {
  return jamaicaDateKey(new Date().toISOString());
}

function jamaicaDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function shiftPeriod(value: string, view: CalendarView, direction: -1 | 1) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (view === "week") date.setUTCDate(date.getUTCDate() + direction * 7);
  else date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

function periodLabel(value: string, view: CalendarView) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return date.toLocaleDateString("en-JM", view === "month" ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function shortDate(value: string) { return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-JM", { month: "short", day: "numeric", timeZone: "UTC" }); }
function longDate(value: string) { return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-JM", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  viewRow: { flexDirection: "row", gap: 7 },
  viewChip: { minHeight: 39, paddingHorizontal: 15, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  viewChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  viewText: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  viewTextActive: { color: colors.white },
  today: { marginLeft: "auto", minHeight: 39, paddingHorizontal: 12, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.cream },
  todayText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  navigator: { padding: 13, flexDirection: "row", alignItems: "center" },
  navButton: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  navCopy: { flex: 1, alignItems: "center" },
  navEyebrow: { color: colors.orange, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  navTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 3 },
  navRange: { color: colors.muted, fontSize: 9, marginTop: 3 },
  vehicleFilter: { minHeight: 54, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  vehicleFilterIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  vehicleFilterCopy: { flex: 1 },
  vehicleFilterLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  vehicleFilterValue: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 3 },
  vehicleOptions: { gap: 6, padding: 9, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  vehicleOption: { padding: 11, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  vehicleOptionActive: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.teal },
  vehicleOptionText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  filterTextActive: { color: colors.white },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, minHeight: 82, padding: 10, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 4 },
  metricLabel: { color: colors.muted, fontSize: 7, fontWeight: "900", marginTop: 2, textAlign: "center" },
  warning: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, backgroundColor: colors.cream },
  warningText: { flex: 1, color: colors.orangeDark, fontSize: 10, lineHeight: 16, fontWeight: "700" },
  error: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  errorText: { flex: 1, color: colors.danger, fontSize: 11 },
  retry: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  loading: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  loadingText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  calendarCard: { padding: 11 },
  weekLabels: { flexDirection: "row", justifyContent: "space-around", marginBottom: 7 },
  weekLabel: { width: 40, color: colors.muted, fontSize: 8, fontWeight: "900", textAlign: "center" },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  day: { width: 40, height: 45, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft },
  dayActive: { backgroundColor: colors.teal },
  dayText: { color: colors.text, fontSize: 11, fontWeight: "900" },
  dayMuted: { color: colors.muted, opacity: 0.55 },
  dayTextActive: { color: colors.white, opacity: 1 },
  dots: { flexDirection: "row", gap: 3, height: 5, marginTop: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.orange },
  dotActive: { backgroundColor: colors.white },
  dotBlocked: { backgroundColor: colors.danger },
  agendaHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  agendaEyebrow: { color: colors.orange, fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  agendaTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 3 },
  countBadge: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  countText: { color: colors.tealDark, fontSize: 12, fontWeight: "900" },
  agenda: { gap: 8 },
  event: { minHeight: 78, padding: 13, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  eventIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  eventIconBlocked: { backgroundColor: colors.surfaceSoft },
  eventCopy: { flex: 1 },
  eventTitleRow: { flexDirection: "row", justifyContent: "space-between", gap: 7 },
  eventKind: { color: colors.orange, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  eventStatus: { color: colors.muted, fontSize: 7, fontWeight: "900" },
  eventTitle: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: 4 },
  eventSubtitle: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  empty: { alignItems: "center", padding: 25, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 5 },
});

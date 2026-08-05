import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { createAdminPromo, fetchAdminVehicles, updateAdminPromo, type AdminPromoItem, type AdminVehicleListItem } from "@/admin/api";
import { hasCapability } from "@/admin/capabilities";
import { EMPTY_PROMO_DRAFT, promoDraftFromItem, validatePromoDraft, type PromoDraft } from "@/admin/promoModel";
import { AdminButton, AdminCard, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export function AdminPromoForm({ mode, promo }: { mode: "create" | "edit"; promo?: AdminPromoItem }) {
  const { request, user } = useAdminAuth(); const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "promotions.write"));
  const initial = useMemo(() => promo ? promoDraftFromItem(promo) : EMPTY_PROMO_DRAFT, [promo]);
  const [draft, setDraft] = useState<PromoDraft>(initial);
  const [vehicles, setVehicles] = useState<AdminVehicleListItem[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => { let current = true; void fetchAdminVehicles(request).then((items) => { if (current) setVehicles(items); }).catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : "Unable to load vehicle restrictions."); }).finally(() => { if (current) setVehiclesLoading(false); }); return () => { current = false; }; }, [request]);

  const requestBack = useCallback(() => { if (busy) return; if (!dirty) { router.back(); return; } Alert.alert("Discard promotion changes?", "Your unsaved offer rules will be lost.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => router.back() }]); }, [busy, dirty]);
  useFocusEffect(useCallback(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", () => { requestBack(); return true; }); return () => subscription.remove(); }, [requestBack]));

  if (!allowed) return <AdminScreen back title="Workspace unavailable" subtitle="Promotion changes require administrator access." />;

  const update = <K extends keyof PromoDraft>(key: K, value: PromoDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const cycleVehicle = (vehicleId: string) => setDraft((current) => current.allowedVehicleIds.includes(vehicleId)
    ? { ...current, allowedVehicleIds: current.allowedVehicleIds.filter((id) => id !== vehicleId), excludedVehicleIds: [...current.excludedVehicleIds, vehicleId] }
    : current.excludedVehicleIds.includes(vehicleId)
      ? { ...current, excludedVehicleIds: current.excludedVehicleIds.filter((id) => id !== vehicleId) }
      : { ...current, allowedVehicleIds: [...current.allowedVehicleIds, vehicleId] });

  const save = async () => {
    const result = validatePromoDraft(draft);
    if (!result.ok) { setError(result.error); return; }
    setBusy(true); setError("");
    try {
      if (mode === "create") {
        const created = await createAdminPromo(request, result.input);
        router.replace(`/admin/promotions/${created.promoId}` as Href);
      } else if (promo) {
        await updateAdminPromo(request, promo.id, result.input);
        router.replace(`/admin/promotions/${promo.id}` as Href);
      }
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save this promotion."); }
    finally { setBusy(false); }
  };

  return <AdminScreen back onBackRequest={requestBack} eyebrow={mode === "create" ? "NEW CAMPAIGN" : "EDIT CAMPAIGN"} title={mode === "create" ? "Create promotion" : `Edit ${promo?.code || "promotion"}`} subtitle="The live booking service enforces every rule entered here.">
    {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
    {dirty ? <View style={styles.dirty}><MaterialIcons name="edit" size={18} color={colors.orangeDark} /><Text style={styles.dirtyText}>Unsaved changes · review the complete offer before saving.</Text></View> : null}
    <AdminCard><SectionTitle title="Offer" body="Use a memorable code and an amount customers can understand." /><Field label="Promo code *" value={draft.code} onChangeText={(value) => update("code", value.toUpperCase().replace(/\s+/g, ""))} autoCapitalize="characters" placeholder="ISLAND10" /><Text style={styles.label}>DISCOUNT TYPE</Text><View style={styles.chips}><Chip label="Percentage" active={draft.discountType === "PERCENT"} onPress={() => update("discountType", "PERCENT")} /><Chip label="Fixed JMD" active={draft.discountType === "FIXED"} onPress={() => update("discountType", "FIXED")} /></View><Field label={draft.discountType === "PERCENT" ? "Discount percentage *" : "Discount amount (JMD) *"} value={draft.discountValue} onChangeText={(value) => update("discountValue", numeric(value))} keyboardType="numeric" placeholder={draft.discountType === "PERCENT" ? "10" : "5000"} /><Text style={styles.label}>APPLIES TO</Text><View style={styles.chips}><Chip label="Rental days" active={draft.applyScope === "DAYS_TOTAL"} onPress={() => update("applyScope", "DAYS_TOTAL")} /><Chip label="Overall subtotal" active={draft.applyScope === "OVERALL_TOTAL"} onPress={() => update("applyScope", "OVERALL_TOTAL")} /></View><Toggle title="Active after save" body="Dates and limits can still keep an active code from becoming eligible." value={draft.isActive} onPress={() => update("isActive", !draft.isActive)} /></AdminCard>
    <AdminCard><SectionTitle title="Eligibility window" body="Times are entered in Jamaica local time (UTC−05:00). Leave both dates blank for no time limit." /><View style={styles.two}><View style={styles.half}><Field label="Start date" value={draft.startDate} onChangeText={(value) => update("startDate", value)} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" /></View><View style={styles.half}><Field label="Start time" value={draft.startTime} onChangeText={(value) => update("startTime", value)} keyboardType="numbers-and-punctuation" placeholder="00:00" /></View></View><View style={styles.two}><View style={styles.half}><Field label="End date" value={draft.endDate} onChangeText={(value) => update("endDate", value)} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" /></View><View style={styles.half}><Field label="End time" value={draft.endTime} onChangeText={(value) => update("endTime", value)} keyboardType="numbers-and-punctuation" placeholder="23:59" /></View></View><Field label="Blackout dates" value={draft.blackoutDates} onChangeText={(value) => update("blackoutDates", value)} multiline placeholder={"YYYY-MM-DD, YYYY-MM-DD"} /><Text style={styles.help}>Separate blackout dates with commas or new lines.</Text></AdminCard>
    <AdminCard><SectionTitle title="Spend and usage limits" body="Blank fields mean no limit. Caps count authoritative paid redemptions." /><Field label="Minimum eligible subtotal (JMD)" value={draft.minSubtotal} onChangeText={(value) => update("minSubtotal", numeric(value))} keyboardType="numeric" /><Field label="Maximum total redemptions" value={draft.maxRedemptions} onChangeText={(value) => update("maxRedemptions", numeric(value))} keyboardType="number-pad" /><Field label="Maximum per customer" value={draft.maxPerCustomer} onChangeText={(value) => update("maxPerCustomer", numeric(value))} keyboardType="number-pad" /></AdminCard>
    <AdminCard><SectionTitle title="Vehicle eligibility" body="Tap each vehicle to cycle: all vehicles → allowed only → excluded → all vehicles." />{vehiclesLoading ? <Text style={styles.help}>Loading fleet…</Text> : null}{vehicles.map((vehicle) => { const state = draft.allowedVehicleIds.includes(vehicle.id) ? "allowed" : draft.excludedVehicleIds.includes(vehicle.id) ? "excluded" : "all"; return <Pressable key={vehicle.id} onPress={() => cycleVehicle(vehicle.id)} style={styles.vehicle}><View style={[styles.vehicleIcon, state === "allowed" && styles.vehicleIconAllowed, state === "excluded" && styles.vehicleIconExcluded]}><MaterialIcons name={state === "allowed" ? "check" : state === "excluded" ? "block" : "remove"} size={18} color={state === "allowed" ? colors.success : state === "excluded" ? colors.danger : colors.muted} /></View><View style={styles.vehicleCopy}><Text style={styles.vehicleTitle}>{vehicle.year} {vehicle.make} {vehicle.model}</Text><Text style={styles.vehicleMeta}>{vehicle.public_id} · {state === "allowed" ? "Allowed only" : state === "excluded" ? "Excluded" : "No special restriction"}</Text></View></Pressable>; })}{!vehiclesLoading && !vehicles.length ? <Text style={styles.help}>No active fleet vehicles are available for restriction rules.</Text> : null}</AdminCard>
    <AdminCard><SectionTitle title="Final review" body="Saving changes affects future eligibility checks immediately; existing booking totals are not silently rewritten." /><Info label="Offer" value={draft.discountType === "PERCENT" ? `${draft.discountValue || "—"}%` : `${draft.discountValue || "—"} JMD`} /><Info label="Window" value={draft.startDate || draft.endDate ? `${draft.startDate || "Now"} → ${draft.endDate || "No end"}` : "No time limit"} /><Info label="Fleet rules" value={`${draft.allowedVehicleIds.length} allowed · ${draft.excludedVehicleIds.length} excluded`} /><Info label="Status after save" value={draft.isActive ? "Active (subject to rules)" : "Paused"} /><AdminButton label={busy ? "Saving promotion…" : mode === "create" ? "Create promotion" : "Save promotion rules"} onPress={() => void save()} disabled={busy || !dirty} icon="save" /></AdminCard>
  </AdminScreen>;
}

function numeric(value: string) { return value.replace(/[^\d.,]/g, ""); }
function SectionTitle({ title, body }: { title: string; body: string }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></>; }
function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.field}><Text style={styles.label}>{label.toUpperCase()}</Text><TextInput {...props} placeholderTextColor={colors.muted} style={[styles.input, props.multiline && styles.inputMultiline]} /></View>; }
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>; }
function Toggle({ title, body, value, onPress }: { title: string; body: string; value: boolean; onPress: () => void }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <Pressable onPress={onPress} style={styles.toggle}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{title}</Text><Text style={styles.toggleBody}>{body}</Text></View><View style={[styles.switchTrack, value && styles.switchTrackOn]}><View style={[styles.switchKnob, value && styles.switchKnobOn]} /></View></Pressable>; }
function Info({ label, value }: { label: string; value: string }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  error: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 11, lineHeight: 17 }, dirty: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radii.lg, backgroundColor: colors.cream }, dirtyText: { flex: 1, color: colors.orangeDark, fontSize: 10, fontWeight: "800" }, title: { color: colors.text, fontSize: 19, fontWeight: "900" }, body: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5 }, field: { marginTop: 13 }, label: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.6, marginTop: 14, marginBottom: 7 }, input: { minHeight: 49, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13 }, inputMultiline: { minHeight: 84, paddingTop: 13, textAlignVertical: "top" }, help: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 7 }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { minHeight: 38, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border }, chipActive: { backgroundColor: colors.teal, borderColor: colors.teal }, chipText: { color: colors.muted, fontSize: 9, fontWeight: "900" }, chipTextActive: { color: colors.white }, toggle: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 17, padding: 12, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, toggleCopy: { flex: 1 }, toggleTitle: { color: colors.text, fontSize: 12, fontWeight: "900" }, toggleBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 }, switchTrack: { width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: colors.border }, switchTrackOn: { backgroundColor: colors.teal }, switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white }, switchKnobOn: { marginLeft: 18 }, two: { flexDirection: "row", gap: 9 }, half: { flex: 1 },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, vehicleIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft }, vehicleIconAllowed: { backgroundColor: colors.cream }, vehicleIconExcluded: { backgroundColor: colors.surfaceSoft }, vehicleCopy: { flex: 1 }, vehicleTitle: { color: colors.text, fontSize: 11, fontWeight: "900" }, vehicleMeta: { color: colors.muted, fontSize: 8, marginTop: 3 }, info: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7 }, infoLabel: { color: colors.muted, fontSize: 11 }, infoValue: { flex: 1, color: colors.text, fontSize: 11, fontWeight: "900", textAlign: "right" },
});

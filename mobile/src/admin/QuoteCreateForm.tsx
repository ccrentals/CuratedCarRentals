import { MaterialIcons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router, type Href, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import {
  createAdminQuote,
  fetchAdminAvailableVehicles,
  fetchAdminBookingLocations,
  fetchAdminInsuranceOption,
  fetchAdminPricingPreview,
  type AdminAvailableVehicle,
  type AdminBookingLocation,
  type AdminInsuranceOption,
  type AdminPricingPreview,
  type AdminQuoteCreateInput,
} from "@/admin/api";
import { buildLocationSelection, jamaicaDateTimeIso, locationFields, locationForType, locationsForSide, prepareQuoteCreate, type LocationValues } from "@/admin/adminCreationModel";
import { hasCapability } from "@/admin/capabilities";
import { AdminButton, AdminCard, AdminScreen } from "@/admin/AdminShell";
import { CalendarPicker } from "@/components/CalendarPicker";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const EMPTY_INSURANCE: AdminInsuranceOption = { enabled: false, planId: null, pricePerDayCents: 0, coverageCents: 0 };

export function AdminQuoteCreateForm() {
  const { request, user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "quotes.write"));
  const [clientRequestId] = useState(() => randomUUID());

  const [customerFullName, setCustomerFullName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("10:00");
  const [dropoffDate, setDropoffDate] = useState("");
  const [dropoffTime, setDropoffTime] = useState("10:00");
  const [locations, setLocations] = useState<AdminBookingLocation[]>([]);
  const [pickupTypeKey, setPickupTypeKey] = useState("");
  const [dropoffTypeKey, setDropoffTypeKey] = useState("");
  const [pickupValues, setPickupValues] = useState<LocationValues>({});
  const [dropoffValues, setDropoffValues] = useState<LocationValues>({});
  const [vehicles, setVehicles] = useState<AdminAvailableVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [insurance, setInsurance] = useState<AdminInsuranceOption>(EMPTY_INSURANCE);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [preview, setPreview] = useState<AdminPricingPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [tags, setTags] = useState("");
  const [comments, setComments] = useState("");
  const [expiresDate, setExpiresDate] = useState("");
  const [commissionPartnerName, setCommissionPartnerName] = useState("");
  const [clientPaysAtPartner, setClientPaysAtPartner] = useState(false);
  const [rackPrice, setRackPrice] = useState("");
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [busy, setBusy] = useState<"" | "availability" | "insurance" | "preview" | "create">("");
  const [error, setError] = useState("");

  const dirty = Boolean(customerFullName || customerEmail || customerPhone || pickupDate || dropoffDate || Object.keys(pickupValues).length || Object.keys(dropoffValues).length || vehicleId || promoCode || tags || comments || expiresDate || commissionPartnerName || rackPrice || clientPaysAtPartner);
  const currentPreviewKey = useMemo(() => JSON.stringify({ vehicleId, pickupDate, dropoffDate, customerEmail: customerEmail.trim().toLowerCase(), insuranceEnabled, insurancePlanId: insuranceEnabled ? insurance.planId : null, promoCode: promoCode.trim().toUpperCase() }), [customerEmail, dropoffDate, insurance.planId, insuranceEnabled, pickupDate, promoCode, vehicleId]);
  const previewCurrent = Boolean(preview && previewKey === currentPreviewKey);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  const context = useMemo(() => ({ pickupDate, pickupTime, dropoffDate, dropoffTime }), [dropoffDate, dropoffTime, pickupDate, pickupTime]);
  const pickupLocation = locationForType(locations, pickupTypeKey, "pickup");
  const dropoffLocation = locationForType(locations, dropoffTypeKey, "dropoff");

  useEffect(() => {
    let current = true;
    void fetchAdminBookingLocations(request)
      .then((items) => {
        if (!current) return;
        setLocations(items);
        const firstPickup = locationsForSide(items, "pickup")[0];
        const firstDropoff = locationsForSide(items, "dropoff")[0];
        setPickupTypeKey(firstPickup?.id ?? firstPickup?.locationTypeKey ?? "");
        setDropoffTypeKey(firstDropoff?.id ?? firstDropoff?.locationTypeKey ?? "");
      })
      .catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : "Unable to load booking locations."); })
      .finally(() => { if (current) setLoadingLocations(false); });
    return () => { current = false; };
  }, [request]);

  const requestBack = useCallback(() => {
    if (busy) return;
    if (!dirty) { router.back(); return; }
    Alert.alert("Discard this quote?", "The customer, trip, and pricing details entered here will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [busy, dirty]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { requestBack(); return true; });
    return () => subscription.remove();
  }, [requestBack]));

  if (!allowed) return <AdminScreen back title="Workspace unavailable" subtitle="Quote creation requires sales access." />;

  const invalidateTrip = () => { setVehicles([]); setVehicleId(""); setInsurance(EMPTY_INSURANCE); setInsuranceEnabled(false); setPreview(null); setPreviewKey(""); };
  const changeTrip = (setter: (value: string) => void, value: string) => { setter(value); invalidateTrip(); };
  const changeDates = (nextPickupDate: string, nextDropoffDate: string) => { setPickupDate(nextPickupDate); setDropoffDate(nextDropoffDate); invalidateTrip(); };
  const invalidatePreview = () => { setPreview(null); setPreviewKey(""); };

  const checkAvailability = async () => {
    const startAt = jamaicaDateTimeIso(pickupDate, pickupTime);
    const endAt = jamaicaDateTimeIso(dropoffDate, dropoffTime);
    if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) { setError("Enter a valid pickup and return window before checking availability."); return; }
    setBusy("availability"); setError(""); setVehicles([]); setVehicleId(""); setInsurance(EMPTY_INSURANCE); setInsuranceEnabled(false); invalidatePreview();
    try {
      const items = await fetchAdminAvailableVehicles(request, pickupDate, dropoffDate);
      setVehicles(items);
      if (!items.length) setError("No vehicles are available for those dates. Try another rental window.");
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to check fleet availability."); }
    finally { setBusy(""); }
  };

  const chooseVehicle = async (vehicle: AdminAvailableVehicle) => {
    setVehicleId(vehicle.id); setInsurance(EMPTY_INSURANCE); setInsuranceEnabled(false); invalidatePreview(); setBusy("insurance"); setError("");
    try { setInsurance(await fetchAdminInsuranceOption(request, vehicle.id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Protection details are unavailable. You can continue without protection."); }
    finally { setBusy(""); }
  };

  const preparePreview = async () => {
    if (!vehicleId) { setError("Choose an available vehicle first."); return; }
    if (insuranceEnabled && !insurance.planId) { setError("The protection option is unavailable for this vehicle."); return; }
    setBusy("preview"); setError(""); invalidatePreview();
    const key = currentPreviewKey;
    try {
      const result = await fetchAdminPricingPreview(request, { vehicleId, startDate: pickupDate, endDate: dropoffDate, customerEmail, insuranceSelected: insuranceEnabled, insurancePlanId: insuranceEnabled ? insurance.planId : null, promoCode });
      setPreview(result); setPreviewKey(key);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to prepare the live quote review."); }
    finally { setBusy(""); }
  };

  const formInput = () => ({ clientRequestId, customerFullName, customerEmail, customerPhone, pickupDate, pickupTime, dropoffDate, dropoffTime, locations, pickupTypeKey, dropoffTypeKey, pickupValues, dropoffValues, vehicleId, insuranceEnabled, insurancePlanId: insurance.planId, promoCode, tags, comments, expiresDate, commissionPartnerName, clientPaysAtPartner, rackPrice });

  const requestCreate = () => {
    const result = prepareQuoteCreate(formInput());
    if (!result.ok) { setError(result.error); return; }
    if (!previewCurrent) { setError("Prepare a fresh live pricing review before creating this quote."); return; }
    Alert.alert("Create this quote?", `${customerFullName.trim()} · ${selectedVehicle?.label || "Selected vehicle"}\n${formatJmd(preview?.totalCents ?? 0)} total`, [
      { text: "Review again", style: "cancel" },
      { text: "Create quote", onPress: () => void confirmCreate(result.payload) },
    ]);
  };

  const confirmCreate = async (payload: AdminQuoteCreateInput) => {
    setBusy("create"); setError("");
    try {
      const created = await createAdminQuote(request, payload);
      router.replace(`/admin/quotes/${created.id}` as Href);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Unable to create this quote."); setBusy(""); }
  };

  const matchPickup = () => {
    if (!pickupLocation) return;
    const matchingDropoff = locationsForSide(locations, "dropoff").find((location) => location.id === pickupLocation.id) ?? locationsForSide(locations, "dropoff").find((location) => location.locationTypeKey === pickupLocation.locationTypeKey);
    if (!matchingDropoff) return;
    setDropoffTypeKey(matchingDropoff.id ?? matchingDropoff.locationTypeKey);
    setDropoffValues(pickupValues.address ? { address: pickupValues.address } : {});
  };
  const selection = buildLocationSelection({ locations, pickupTypeKey, dropoffTypeKey, pickupValues, dropoffValues, context });

  return <AdminScreen back onBackRequest={requestBack} eyebrow="NEW SALES QUOTE" title="Create quote" subtitle="Build an accurate, server-priced offer. Nothing is saved until the final confirmation.">
    {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
    {dirty ? <View style={styles.dirty}><MaterialIcons name="edit" size={18} color={colors.orangeDark} /><Text style={styles.dirtyText}>Draft on this device · not yet saved to the customer record.</Text></View> : null}

    <AdminCard><SectionTitle number="1" title="Customer and trip" body="Dates and times are Jamaica local time (UTC−05:00)." /><Field label="Customer full name *" value={customerFullName} onChangeText={setCustomerFullName} autoCapitalize="words" /><Field label="Email *" value={customerEmail} onChangeText={(value) => { setCustomerEmail(value); invalidatePreview(); }} autoCapitalize="none" keyboardType="email-address" /><Field label="Phone" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" /><CalendarPicker pickupDate={pickupDate} returnDate={dropoffDate} minimumDays={1} onChange={changeDates} /><View style={styles.two}><View style={styles.half}><Field label="Pickup time *" value={pickupTime} onChangeText={(value) => changeTrip(setPickupTime, value)} placeholder="10:00" keyboardType="numbers-and-punctuation" /></View><View style={styles.half}><Field label="Return time *" value={dropoffTime} onChangeText={(value) => changeTrip(setDropoffTime, value)} placeholder="10:00" keyboardType="numbers-and-punctuation" /></View></View></AdminCard>

    <AdminCard><SectionTitle number="2" title="Pickup and return" body="Location-specific fields are preserved with the quote for operational handoff." />{loadingLocations ? <Text style={styles.help}>Loading configured locations…</Text> : <><Text style={styles.label}>PICKUP LOCATION *</Text><View style={styles.chips}>{locationsForSide(locations, "pickup").map((location) => { const selector = location.id ?? location.locationTypeKey; return <Chip key={selector} label={location.pickupLabel} active={pickupTypeKey === selector} onPress={() => { setPickupTypeKey(selector); setPickupValues({}); }} />; })}</View>{locationFields(pickupLocation, "pickup").map((field) => <Field key={`pickup-${field.key}`} label={`${field.label}${field.required ? " *" : ""}`} value={pickupValues[field.key] ?? ""} onChangeText={(value) => setPickupValues((current) => ({ ...current, [field.key]: value }))} placeholder={field.defaultSource ? `Defaults to ${field.defaultSource.replaceAll("_", " ")}` : undefined} keyboardType={field.inputType === "text" ? "default" : "numbers-and-punctuation"} />)}<Pressable onPress={matchPickup} style={styles.match}><MaterialIcons name="content-copy" size={16} color={colors.tealDark} /><Text style={styles.matchText}>Use pickup location for return</Text></Pressable><Text style={styles.label}>RETURN LOCATION *</Text><View style={styles.chips}>{locationsForSide(locations, "dropoff").map((location) => { const selector = location.id ?? location.locationTypeKey; return <Chip key={selector} label={location.dropoffLabel} active={dropoffTypeKey === selector} onPress={() => { setDropoffTypeKey(selector); setDropoffValues({}); }} />; })}</View>{locationFields(dropoffLocation, "dropoff").map((field) => <Field key={`dropoff-${field.key}`} label={`${field.label}${field.required ? " *" : ""}`} value={dropoffValues[field.key] ?? ""} onChangeText={(value) => setDropoffValues((current) => ({ ...current, [field.key]: value }))} placeholder={field.defaultSource ? `Defaults to ${field.defaultSource.replaceAll("_", " ")}` : undefined} keyboardType={field.inputType === "text" ? "default" : "numbers-and-punctuation"} />)}</>}</AdminCard>

    <AdminCard><SectionTitle number="3" title="Vehicle and protection" body="Check the operational calendar, then choose one available vehicle." /><AdminButton label={busy === "availability" ? "Checking fleet…" : vehicles.length ? "Refresh availability" : "Check live availability"} onPress={() => void checkAvailability()} disabled={Boolean(busy) || loadingLocations} secondary icon="event-available" />{vehicles.map((vehicle) => <Pressable key={vehicle.id} onPress={() => void chooseVehicle(vehicle)} disabled={Boolean(busy)} style={[styles.vehicle, vehicleId === vehicle.id && styles.vehicleSelected]}><View style={[styles.vehicleIcon, vehicleId === vehicle.id && styles.vehicleIconSelected]}><MaterialIcons name={vehicleId === vehicle.id ? "check" : "directions-car"} size={19} color={vehicleId === vehicle.id ? colors.white : colors.tealDark} /></View><View style={styles.vehicleCopy}><Text style={styles.vehicleTitle}>{vehicle.label}</Text><Text style={styles.vehicleMeta}>{formatJmd(vehicle.dailyRateCents)} / day · {formatJmd(vehicle.depositCents)} deposit</Text></View></Pressable>)}{vehicles.length ? <Text style={styles.help}>The server rechecks the exact pickup and return times when the quote is created.</Text> : null}{vehicleId && busy === "insurance" ? <Text style={styles.help}>Loading protection option…</Text> : null}{vehicleId && !busy ? <Toggle title="Include protection" body={insurance.enabled ? `${formatJmd(insurance.pricePerDayCents)} / day · ${formatJmd(insurance.coverageCents)} coverage` : "No enabled protection plan is configured for this vehicle."} value={insuranceEnabled} disabled={!insurance.enabled} onPress={() => { setInsuranceEnabled((value) => !value); invalidatePreview(); }} /> : null}</AdminCard>

    <AdminCard><SectionTitle number="4" title="Live pricing review" body="Promo codes are validated against the customer, trip, vehicle, and current campaign rules." /><Field label="Promo code" value={promoCode} onChangeText={(value) => { setPromoCode(value.toUpperCase().replace(/\s+/g, "")); invalidatePreview(); }} autoCapitalize="characters" placeholder="Optional" /><AdminButton label={busy === "preview" ? "Preparing review…" : previewCurrent ? "Refresh live pricing" : "Prepare live pricing"} onPress={() => void preparePreview()} disabled={Boolean(busy) || !vehicleId} icon="calculate" />{previewCurrent && preview ? <View style={styles.pricing}><Info label={`${preview.days} rental ${preview.days === 1 ? "day" : "days"}`} value={formatJmd(preview.baseTotalCents)} /><Info label="Protection" value={formatJmd(preview.insuranceTotalCents)} />{preview.promoDiscountCents > 0 ? <Info label={`Promotion${preview.promoCode ? ` · ${preview.promoCode}` : ""}`} value={`−${formatJmd(preview.promoDiscountCents)}`} good /> : null}<View style={styles.rule} /><Info label="Quote total" value={formatJmd(preview.totalCents)} strong /><Info label="Suggested due now" value={formatJmd(preview.dueNowCents)} /><Info label="Balance after deposit" value={formatJmd(preview.balanceDueCents)} /></View> : null}</AdminCard>

    <AdminCard><SectionTitle number="5" title="Internal sales context" body="These details support staff follow-up and are not a substitute for the customer-facing quote." /><Field label="Tags" value={tags} onChangeText={setTags} placeholder="VIP, airport, partner" /><Field label="Internal comments" value={comments} onChangeText={setComments} multiline placeholder="Follow-up notes for staff" /><Field label="Quote expires on" value={expiresDate} onChangeText={setExpiresDate} placeholder="YYYY-MM-DD (optional)" keyboardType="numbers-and-punctuation" /><Field label="Commission partner" value={commissionPartnerName} onChangeText={setCommissionPartnerName} placeholder="Optional" /><Field label="Rack price (whole JMD)" value={rackPrice} onChangeText={(value) => setRackPrice(value.replace(/[^\d,]/g, ""))} keyboardType="number-pad" placeholder="Optional" /><Toggle title="Customer pays partner" body="Record that payment collection is handled by the named commission partner." value={clientPaysAtPartner} disabled={!commissionPartnerName.trim()} onPress={() => setClientPaysAtPartner((value) => !value)} /></AdminCard>

    <AdminCard><SectionTitle number="6" title="Final confirmation" body="Review the handoff below. Creating saves a draft quote; it does not email the customer or create a booking." /><Info label="Customer" value={customerFullName.trim() || "Not entered"} /><Info label="Trip" value={pickupDate && dropoffDate ? `${pickupDate} ${pickupTime} → ${dropoffDate} ${dropoffTime}` : "Not complete"} /><Info label="Route" value={`${selection.pickupText || "Pickup not set"} → ${selection.dropoffText || "Return not set"}`} /><Info label="Vehicle" value={selectedVehicle?.label || "Not selected"} /><Info label="Pricing" value={previewCurrent && preview ? formatJmd(preview.totalCents) : "Prepare a fresh review"} strong /><View style={styles.commitNotice}><MaterialIcons name="info-outline" size={19} color={colors.tealDark} /><Text style={styles.commitText}>Only the next confirmed action writes this quote to the live system.</Text></View><AdminButton label={busy === "create" ? "Creating quote…" : "Review and create quote"} onPress={requestCreate} disabled={Boolean(busy) || !previewCurrent} icon="request-quote" /></AdminCard>
  </AdminScreen>;
}

function SectionTitle({ number, title, body }: { number: string; title: string; body: string }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.sectionHead}><View style={styles.step}><Text style={styles.stepText}>{number}</Text></View><View style={styles.sectionCopy}><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View></View>; }
function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.field}><Text style={styles.label}>{label.toUpperCase()}</Text><TextInput {...props} placeholderTextColor={colors.muted} style={[styles.input, props.multiline && styles.inputMultiline]} /></View>; }
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>; }
function Toggle({ title, body, value, disabled, onPress }: { title: string; body: string; value: boolean; disabled?: boolean; onPress: () => void }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <Pressable onPress={onPress} disabled={disabled} style={[styles.toggle, disabled && styles.disabled]}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{title}</Text><Text style={styles.toggleBody}>{body}</Text></View><View style={[styles.switchTrack, value && styles.switchTrackOn]}><View style={[styles.switchKnob, value && styles.switchKnobOn]} /></View></Pressable>; }
function Info({ label, value, strong, good }: { label: string; value: string; strong?: boolean; good?: boolean }) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.info}><Text style={[styles.infoLabel, strong && styles.infoStrong]}>{label}</Text><Text style={[styles.infoValue, strong && styles.infoStrong, good && styles.infoGood]}>{value}</Text></View>; }
function formatJmd(value: number) { return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0)); }

const makeStyles = (colors: AppColors) => StyleSheet.create({
  error: { flexDirection: "row", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 11, lineHeight: 17 },
  dirty: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radii.lg, backgroundColor: colors.cream }, dirtyText: { flex: 1, color: colors.orangeDark, fontSize: 10, fontWeight: "800" },
  sectionHead: { flexDirection: "row", alignItems: "flex-start", gap: 11 }, step: { width: 32, height: 32, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }, stepText: { color: colors.white, fontSize: 12, fontWeight: "900" }, sectionCopy: { flex: 1 }, title: { color: colors.text, fontSize: 19, fontWeight: "900" }, body: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  field: { marginTop: 13 }, label: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.6, marginTop: 8, marginBottom: 7 }, input: { minHeight: 49, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13 }, inputMultiline: { minHeight: 88, paddingTop: 13, textAlignVertical: "top" },
  two: { flexDirection: "row", gap: 9 }, half: { flex: 1 }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { minHeight: 39, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border }, chipActive: { backgroundColor: colors.teal, borderColor: colors.teal }, chipText: { color: colors.muted, fontSize: 9, fontWeight: "900" }, chipTextActive: { color: colors.white },
  match: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 15, paddingVertical: 8 }, matchText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" }, help: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 9 },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, padding: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }, vehicleSelected: { borderColor: colors.teal, backgroundColor: colors.cream }, vehicleIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, vehicleIconSelected: { backgroundColor: colors.teal }, vehicleCopy: { flex: 1 }, vehicleTitle: { color: colors.text, fontSize: 12, fontWeight: "900" }, vehicleMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 15, padding: 12, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, disabled: { opacity: 0.48 }, toggleCopy: { flex: 1 }, toggleTitle: { color: colors.text, fontSize: 12, fontWeight: "900" }, toggleBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 }, switchTrack: { width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: colors.border }, switchTrackOn: { backgroundColor: colors.teal }, switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white }, switchKnobOn: { marginLeft: 18 },
  pricing: { marginTop: 14, padding: 13, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, rule: { height: 1, backgroundColor: colors.border, marginVertical: 7 }, info: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7 }, infoLabel: { flex: 1, color: colors.muted, fontSize: 11 }, infoValue: { flex: 1, color: colors.text, fontSize: 11, fontWeight: "900", textAlign: "right" }, infoStrong: { color: colors.text, fontSize: 13, fontWeight: "900" }, infoGood: { color: colors.success },
  commitNotice: { flexDirection: "row", gap: 8, padding: 12, marginTop: 10, borderRadius: radii.md, backgroundColor: colors.cream }, commitText: { flex: 1, color: colors.tealDark, fontSize: 10, lineHeight: 15, fontWeight: "800" },
});

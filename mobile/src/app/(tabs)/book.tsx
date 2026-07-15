import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Field, Notice, PageIntro, Screen } from "@/components/primitives";
import { SignaturePad } from "@/components/SignaturePad";
import { colors, radii } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";
import {
  fetchBookingLocations,
  completeBookingSecurityChallenge,
  createBooking,
  startDepositPayment,
  fetchInsuranceOption,
  fetchMinimumRentalDays,
  fetchPricingQuote,
  fetchVehicles,
  type BookingLocation,
  type BookingCreateResult,
  type BookingStatus,
  type InsuranceOption,
  type PricingQuote,
} from "@/services/api";
import { saveCurrentBooking } from "@/services/bookingStore";

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function BookingScreen() {
  const params = useLocalSearchParams<{ vehicle?: string }>();
  const { vehicles, loading: fleetLoading, source, error: fleetError } = useFleet();
  const [vehicleId, setVehicleId] = useState(params.vehicle || "");
  const [pickup, setPickup] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [locations, setLocations] = useState<BookingLocation[]>([]);
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [dropoffLocationId, setDropoffLocationId] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [insurance, setInsurance] = useState<InsuranceOption | null>(null);
  const [insuranceSelected, setInsuranceSelected] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingCreateResult | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | null>(null);
  const [error, setError] = useState("");
  const selectedVehicleId = vehicles.some((item) => item.id === vehicleId)
    ? vehicleId
    : vehicles[0]?.id ?? "";
  const vehicle = vehicles.find((item) => item.id === selectedVehicleId);

  useEffect(() => {
    let active = true;
    void fetchBookingLocations().then((nextLocations) => {
      if (!active) return;
      setLocations(nextLocations);
      const firstPickup = nextLocations.find((item) => item.allowPickup);
      const firstDropoff = nextLocations.find((item) => item.allowDropoff);
      setPickupLocationId((current) => current || firstPickup?.id || "");
      setDropoffLocationId((current) => current || firstDropoff?.id || "");
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedVehicleId || vehicle?.source !== "live") return;
    let active = true;
    void fetchInsuranceOption(selectedVehicleId).then((option) => {
      if (!active) return;
      setInsurance(option);
      if (!option.enabled) setInsuranceSelected(false);
    }).catch(() => {
      if (active) setInsurance(null);
    });
    return () => { active = false; };
  }, [selectedVehicleId, vehicle?.source]);

  const days = useMemo(() => {
    const start = parseDate(pickup);
    const end = parseDate(returnDate);
    if (!start || !end) return 0;
    return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  }, [pickup, returnDate]);
  const fallbackTotal = days * (vehicle?.dailyRate ?? 0);
  const total = quote?.total ?? fallbackTotal;
  const dueNow = quote?.dueNow ?? Math.round(fallbackTotal * 0.3);
  const dueOnPickup = quote?.dueOnPickup ?? Math.max(0, fallbackTotal - dueNow);
  const pickupLocation = locations.find((item) => item.id === pickupLocationId);
  const dropoffLocation = locations.find((item) => item.id === dropoffLocationId);

  const resetReview = () => {
    setSubmitted(false);
    setQuote(null);
    setBookingResult(null);
    setError("");
  };

  const review = async () => {
    setSubmitted(false);
    setQuote(null);
    if (days < 1) return setError("Enter valid pickup and return dates in YYYY-MM-DD format. Return must be after pickup.");
    if (!name.trim() || !email.includes("@") || phone.trim().length < 7) return setError("Add your full name, a valid email address and phone number.");
    if (!vehicle) return setError("Choose an available vehicle.");
    if (locations.length > 0 && (!pickupLocation || !dropoffLocation)) return setError("Choose pickup and return locations.");
    if (pickupLocation?.locationTypeKey === "CUSTOM_ADDRESS" && pickupAddress.trim().length < 5) return setError("Enter the pickup address.");
    if (dropoffLocation?.locationTypeKey === "CUSTOM_ADDRESS" && dropoffAddress.trim().length < 5) return setError("Enter the return address.");
    setError("");
    setReviewing(true);

    try {
      if (vehicle.source === "live") {
        const [minimumDays, availableVehicles] = await Promise.all([
          fetchMinimumRentalDays(),
          fetchVehicles({ pickupDate: pickup, dropoffDate: returnDate, pickupTime: "11:00", dropoffTime: "11:00" }),
        ]);
        if (days < minimumDays) throw new Error(`The minimum rental period is ${minimumDays} days.`);
        if (!availableVehicles.some((item) => item.id === vehicle.id)) {
          throw new Error(`${vehicle.name} is not available for those dates. Choose another vehicle or change your dates.`);
        }
        const deliverySelected = pickupLocation?.locationTypeKey === "CUSTOM_ADDRESS" || dropoffLocation?.locationTypeKey === "CUSTOM_ADDRESS";
        const deliveryZoneLabel = [pickupAddress || pickupLocation?.pickupLabel, dropoffAddress || dropoffLocation?.dropoffLabel].filter(Boolean).join(" → ");
        const liveQuote = await fetchPricingQuote({
          vehicleId: vehicle.id,
          pickupDate: pickup,
          returnDate,
          customerEmail: email,
          insuranceSelected,
          insurancePlanId: insuranceSelected ? insurance?.planId : null,
          deliverySelected,
          deliveryZoneLabel: deliveryZoneLabel || null,
        });
        setQuote(liveQuote);
      }
      setSubmitted(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to review this reservation.");
    } finally {
      setReviewing(false);
    }
  };

  const confirmBooking = async () => {
    if (!quote || !vehicle || !pickupLocation || !dropoffLocation) {
      setError("Review the live reservation before confirming it.");
      return;
    }
    if (!signatureDataUrl) {
      setError("Draw and save your signature before confirming the reservation.");
      return;
    }
    setBookingBusy(true);
    setError("");
    try {
      const turnstileToken = await completeBookingSecurityChallenge();
      const result = await createBooking({
        vehicleId: vehicle.id,
        fullName: name,
        email,
        phone,
        startDate: pickup,
        endDate: returnDate,
        pickupLocation,
        dropoffLocation,
        pickupAddress,
        dropoffAddress,
        insuranceSelected,
        insurancePlanId: insuranceSelected ? insurance?.planId || null : null,
        signatureDataUrl,
        turnstileToken,
      });
      await saveCurrentBooking(result);
      setBookingResult(result);
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Unable to create the reservation.");
    } finally {
      setBookingBusy(false);
    }
  };

  const payDeposit = async () => {
    if (!bookingResult) return;
    setPaymentBusy(true);
    setError("");
    try {
      const status = await startDepositPayment(bookingResult.bookingId, bookingResult.bookingAccessToken);
      setBookingStatus(status);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start deposit payment.");
    } finally {
      setPaymentBusy(false);
    }
  };

  return (
    <Screen>
      <PageIntro eyebrow="Guided reservation" title="Book Your Vehicle" description="Choose your dates and vehicle, review the deposit due now, and see the balance due on pickup." />
      {fleetLoading ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>Loading live fleet…</Text></View> : null}
      {fleetError ? <Notice error>{fleetError} Offline estimates are shown until the service reconnects.</Notice> : null}
      <Card>
        <Text style={styles.cardTitle}>1. Choose a vehicle</Text>
        <View style={styles.choices}>
          {vehicles.map((item) => (
            <Pressable key={item.id} onPress={() => { setVehicleId(item.id); resetReview(); }} style={[styles.choice, selectedVehicleId === item.id && styles.choiceActive]} accessibilityRole="radio" accessibilityState={{ checked: selectedVehicleId === item.id }}>
              <Text style={[styles.choiceTitle, selectedVehicleId === item.id && styles.choiceTitleActive]}>{item.name}</Text>
              <Text style={[styles.choiceMeta, selectedVehicleId === item.id && styles.choiceMetaActive]}>{formatJmd(item.dailyRate)}/day</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>2. Trip dates</Text>
        <Field label="Pickup date" value={pickup} onChangeText={(value) => { setPickup(value); resetReview(); }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
        <Field label="Return date" value={returnDate} onChangeText={(value) => { setReturnDate(value); resetReview(); }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>3. Driver details</Text>
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <Button label={reviewing ? "Checking availability…" : "Review reservation"} onPress={() => void review()} disabled={reviewing || fleetLoading || !vehicle} />
        {error ? <Notice error>{error}</Notice> : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>4. Pickup and return</Text>
        {locations.length === 0 ? <Notice>Location choices will be confirmed during final checkout.</Notice> : null}
        <Text style={styles.fieldHeading}>Pickup location</Text>
        <View style={styles.choices}>
          {locations.filter((item) => item.allowPickup).map((item) => (
            <Pressable key={`pickup-${item.id}`} onPress={() => { setPickupLocationId(item.id); resetReview(); }} style={[styles.choice, pickupLocationId === item.id && styles.choiceActive]} accessibilityRole="radio" accessibilityState={{ checked: pickupLocationId === item.id }}>
              <Text style={[styles.choiceTitle, pickupLocationId === item.id && styles.choiceTitleActive]}>{item.pickupLabel}</Text>
            </Pressable>
          ))}
        </View>
        {pickupLocation?.locationTypeKey === "CUSTOM_ADDRESS" ? <Field label="Pickup address" value={pickupAddress} onChangeText={(value) => { setPickupAddress(value); resetReview(); }} autoComplete="street-address" /> : null}

        <Text style={styles.fieldHeading}>Return location</Text>
        <View style={styles.choices}>
          {locations.filter((item) => item.allowDropoff).map((item) => (
            <Pressable key={`dropoff-${item.id}`} onPress={() => { setDropoffLocationId(item.id); resetReview(); }} style={[styles.choice, dropoffLocationId === item.id && styles.choiceActive]} accessibilityRole="radio" accessibilityState={{ checked: dropoffLocationId === item.id }}>
              <Text style={[styles.choiceTitle, dropoffLocationId === item.id && styles.choiceTitleActive]}>{item.dropoffLabel}</Text>
            </Pressable>
          ))}
        </View>
        {dropoffLocation?.locationTypeKey === "CUSTOM_ADDRESS" ? <Field label="Return address" value={dropoffAddress} onChangeText={(value) => { setDropoffAddress(value); resetReview(); }} autoComplete="street-address" /> : null}
      </Card>

      {insurance?.enabled ? (
        <Card>
          <Text style={styles.cardTitle}>5. Optional protection</Text>
          <Text style={styles.helpText}>{formatJmd(insurance.pricePerDay)} per day. Coverage limit: {formatJmd(insurance.coverage)}.</Text>
          <Pressable onPress={() => { setInsuranceSelected((value) => !value); resetReview(); }} style={[styles.choice, insuranceSelected && styles.choiceActive]} accessibilityRole="checkbox" accessibilityState={{ checked: insuranceSelected }}>
            <Text style={[styles.choiceTitle, insuranceSelected && styles.choiceTitleActive]}>{insuranceSelected ? "✓ Protection selected" : "Add protection"}</Text>
          </Pressable>
        </Card>
      ) : null}

      {submitted && vehicle ? (
        <Card style={styles.summary}>
          <Text style={styles.cardTitle}>Reservation summary</Text>
          <Row label="Vehicle" value={vehicle.name} />
          <Row label="Rental period" value={`${days} ${days === 1 ? "day" : "days"}`} />
          <Row label="Rental total" value={formatJmd(total)} />
          {quote && quote.insuranceTotal > 0 ? <Row label="Optional protection" value={formatJmd(quote.insuranceTotal)} /> : null}
          <Row label="Pricing source" value={quote ? "Live server quote" : source === "live" ? "Current listed rate" : "Offline estimate"} />
          <View style={styles.divider} />
          <Row label="Deposit due now" value={formatJmd(dueNow)} strong />
          <Row label="Balance due on pickup" value={formatJmd(dueOnPickup)} strong />
          <Text style={styles.disclaimer}>{vehicle.securityDeposit > 0 ? `Security deposit of ${formatJmd(vehicle.securityDeposit)} is separate and refundable according to the rental policy. ` : "The refundable security deposit is confirmed during booking. "}{quote ? "Availability and pricing were verified by the live rental service." : "This is an offline estimate and must be rechecked before checkout."}</Text>
        </Card>
      ) : null}

      {submitted && quote && !bookingResult ? (
        <Card>
          <Text style={styles.cardTitle}>6. Sign and confirm</Text>
          <Text style={styles.helpText}>By signing, you confirm the dates, selected vehicle, pricing and rental-policy acknowledgement shown above.</Text>
          <SignaturePad onChange={setSignatureDataUrl} />
          <Button label={bookingBusy ? "Opening security check…" : "Confirm reservation"} onPress={() => void confirmBooking()} disabled={bookingBusy || !signatureDataUrl} />
          {error ? <Notice error>{error}</Notice> : null}
        </Card>
      ) : null}

      {bookingResult ? (
        <Card style={styles.success}>
          <Text style={styles.successTitle}>Reservation created</Text>
          <Text style={styles.helpText}>Booking reference: {bookingResult.bookingId}</Text>
          <Text style={styles.helpText}>Status: {bookingResult.status.replaceAll("_", " ")}</Text>
          {bookingStatus ? <Text style={styles.helpText}>Payment: {bookingStatus.paymentStatus.replaceAll("_", " ")} · Balance {formatJmd(bookingStatus.balanceDue)}</Text> : null}
          <Notice>{bookingStatus?.paymentStatus === "DEPOSIT_PAID" || bookingStatus?.paymentStatus === "PAID_IN_FULL" ? "Payment received. Your reservation status will update according to the rental workflow." : "Your reservation is recorded. Complete the required deposit to secure the vehicle."}</Notice>
          <Button label={paymentBusy ? "Checking payment…" : "Pay deposit securely"} onPress={() => void payDeposit()} disabled={paymentBusy || bookingStatus?.paymentStatus === "DEPOSIT_PAID" || bookingStatus?.paymentStatus === "PAID_IN_FULL"} />
          {error ? <Notice error>{error}</Notice> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.row}><Text style={[styles.rowText, strong && styles.strong]}>{label}</Text><Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.text, fontSize: 21, fontWeight: "800", marginBottom: 4 },
  choices: { gap: 10, marginTop: 14 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14, backgroundColor: colors.surfaceSoft },
  choiceActive: { borderColor: colors.teal, backgroundColor: colors.teal },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  choiceTitleActive: { color: colors.white },
  choiceMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  choiceMetaActive: { color: "rgba(255,255,255,0.8)" },
  summary: { backgroundColor: colors.cream, borderColor: colors.sand },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 14 },
  rowText: { color: colors.muted, flex: 1, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "right" },
  strong: { color: colors.tealDark, fontWeight: "900" },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 16 },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 18 },
  loading: { marginHorizontal: 20, marginVertical: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  loadingText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  fieldHeading: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 18, marginBottom: 2 },
  helpText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginVertical: 12 },
  success: { backgroundColor: "#EAF7F1", borderColor: "#B8E0CE" },
  successTitle: { color: colors.tealDark, fontSize: 25, fontWeight: "900" },
});

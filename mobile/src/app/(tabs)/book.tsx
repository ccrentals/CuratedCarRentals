import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { CalendarPicker } from "@/components/CalendarPicker";
import { Button, Card, Field, Notice, PageIntro, Screen } from "@/components/primitives";
import { SignaturePad } from "@/components/SignaturePad";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, shadow, type AppColors } from "@/constants/theme";
import { formatJmd, type Vehicle } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";
import {
  completeBookingSecurityChallenge,
  createBooking,
  fetchBookingLocations,
  fetchInsuranceOption,
  fetchMinimumRentalDays,
  fetchPricingQuote,
  fetchVehicles,
  selectPayOnPickup,
  startBookingPayment,
  validatePromoCode,
  type BookingCreateResult,
  type BookingLocation,
  type BookingStatus,
  type InsuranceOption,
  type PaymentOption,
  type PricingQuote,
  type PromoValidation,
} from "@/services/api";
import { saveCurrentBooking } from "@/services/bookingStore";

type WizardPage = 1 | 2 | 3;

const PAYMENT_OPTIONS: { value: PaymentOption; title: string; body: string }[] = [
  { value: "DEPOSIT", title: "Pay deposit", body: "Secure the vehicle now and pay the balance at pickup." },
  { value: "FULL", title: "Pay in full", body: "Complete the full rental payment securely with WiPay." },
  { value: "CUSTOM", title: "Choose amount", body: "Pay a custom amount now. Amounts below the deposit may not reserve the car." },
  { value: "NONE", title: "Pay on pickup", body: "Reserve now and settle the rental amount when collecting the vehicle." },
];

function useBookingStyles() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return { colors, styles };
}

function parseDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rentalDays(pickupDate: string, returnDate: string) {
  const start = parseDate(pickupDate);
  const end = parseDate(returnDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

export default function BookingScreen() {
  const { styles } = useBookingStyles();
  const params = useLocalSearchParams<{ vehicle?: string }>();
  const { vehicles, loading: fleetLoading, error: fleetError } = useFleet();
  const screenRef = useRef<ScrollView>(null);
  const [page, setPage] = useState<WizardPage>(1);
  const [dateFilteredVehicles, setDateFilteredVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState(params.vehicle || "");
  const [pickupDate, setPickupDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [minimumDays, setMinimumDays] = useState(1);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [locations, setLocations] = useState<BookingLocation[]>([]);
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [dropoffLocationId, setDropoffLocationId] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [insurance, setInsurance] = useState<InsuranceOption | null>(null);
  const [insuranceSelected, setInsuranceSelected] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<PromoValidation | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [paymentOption, setPaymentOption] = useState<PaymentOption>("DEPOSIT");
  const [customPaymentAmount, setCustomPaymentAmount] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingCreateResult | null>(null);
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([fetchMinimumRentalDays(), fetchBookingLocations()])
      .then(([days, nextLocations]) => {
        if (!active) return;
        setMinimumDays(days);
        setLocations(nextLocations);
        setPickupLocationId((current) => current || nextLocations.find((item) => item.allowPickup)?.id || "");
        setDropoffLocationId((current) => current || nextLocations.find((item) => item.allowDropoff)?.id || "");
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const availableVehicles = dateFilteredVehicles ?? vehicles;
  const selectedVehicleId = availableVehicles.some((item) => item.id === vehicleId)
    ? vehicleId
    : availableVehicles[0]?.id ?? "";
  const vehicle = availableVehicles.find((item) => item.id === selectedVehicleId);
  const pickupLocation = locations.find((item) => item.id === pickupLocationId);
  const dropoffLocation = locations.find((item) => item.id === dropoffLocationId);
  const days = useMemo(() => rentalDays(pickupDate, returnDate), [pickupDate, returnDate]);
  const deliverySelected = pickupLocation?.locationTypeKey === "CUSTOM_ADDRESS" || dropoffLocation?.locationTypeKey === "CUSTOM_ADDRESS";
  const deliveryZoneLabel = [pickupAddress || pickupLocation?.pickupLabel, dropoffAddress || dropoffLocation?.dropoffLabel].filter(Boolean).join(" → ") || null;
  const customAmount = Number(customPaymentAmount.replace(/[^0-9.]/g, ""));

  useEffect(() => {
    const frame = requestAnimationFrame(() => screenRef.current?.scrollTo({ y: 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [page]);

  useEffect(() => {
    if (!selectedVehicleId || vehicle?.source !== "live") return;
    let active = true;
    void fetchInsuranceOption(selectedVehicleId)
      .then((option) => {
        if (!active) return;
        setInsurance(option);
        if (!option.enabled) setInsuranceSelected(false);
      })
      .catch(() => active && setInsurance(null));
    return () => { active = false; };
  }, [selectedVehicleId, vehicle?.source]);

  const invalidateReview = () => {
    setQuote(null);
    setError("");
  };

  const changeDates = (nextPickup: string, nextReturn: string) => {
    setPickupDate(nextPickup);
    setReturnDate(nextReturn);
    setPromo(null);
    invalidateReview();
    if (!nextPickup || !nextReturn) {
      setDateFilteredVehicles(null);
      return;
    }
    setAvailabilityBusy(true);
    void fetchVehicles({ pickupDate: nextPickup, dropoffDate: nextReturn, pickupTime: "11:00", dropoffTime: "11:00" })
      .then((nextVehicles) => {
        setDateFilteredVehicles(nextVehicles);
        if (!nextVehicles.some((item) => item.id === selectedVehicleId)) setVehicleId(nextVehicles[0]?.id || "");
        if (nextVehicles.length === 0) setError("No vehicles are available for those dates. Try another date range.");
      })
      .catch((availabilityError) => setError(availabilityError instanceof Error ? availabilityError.message : "Unable to refresh availability."))
      .finally(() => setAvailabilityBusy(false));
  };

  const continueToDetails = async () => {
    if (days < minimumDays) return setError(`Choose a rental period of at least ${minimumDays} ${minimumDays === 1 ? "day" : "days"}.`);
    if (!vehicle || vehicle.source !== "live") return setError("Connect to the live rental service and choose an available vehicle.");
    if (!pickupLocation || !dropoffLocation) return setError("Choose pickup and return locations.");
    if (pickupLocation.locationTypeKey === "CUSTOM_ADDRESS" && pickupAddress.trim().length < 5) return setError("Enter a complete pickup address.");
    if (dropoffLocation.locationTypeKey === "CUSTOM_ADDRESS" && dropoffAddress.trim().length < 5) return setError("Enter a complete return address.");
    setAvailabilityBusy(true);
    setError("");
    try {
      const nextVehicles = await fetchVehicles({ pickupDate, dropoffDate: returnDate, pickupTime: "11:00", dropoffTime: "11:00" });
      if (!nextVehicles.some((item) => item.id === vehicle.id)) throw new Error(`${vehicle.name} is no longer available for these dates.`);
      setDateFilteredVehicles(nextVehicles);
      setPage(2);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to confirm availability.");
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const applyPromo = async () => {
    if (!vehicle || !promoInput.trim()) return setError("Enter a promo code first.");
    if (!email.includes("@")) return setError("Add your email before validating a promo code.");
    setPromoBusy(true);
    setError("");
    try {
      const result = await validatePromoCode({
        code: promoInput.trim(),
        vehicleId: vehicle.id,
        pickupDate,
        returnDate,
        customerEmail: email,
        insuranceSelected,
        insurancePlanId: insuranceSelected ? insurance?.planId : null,
        deliverySelected,
        deliveryZoneLabel,
      });
      setPromo(result);
      setPromoInput(result.code);
      setQuote(null);
    } catch (promoError) {
      setPromo(null);
      setError(promoError instanceof Error ? promoError.message : "Unable to validate that promo code.");
    } finally {
      setPromoBusy(false);
    }
  };

  const reviewReservation = async () => {
    if (!vehicle) return setError("Choose an available vehicle.");
    if (fullName.trim().length < 2 || !email.includes("@") || phone.trim().length < 7) return setError("Add your full name, valid email, and phone number.");
    if (paymentOption === "CUSTOM" && (!Number.isFinite(customAmount) || customAmount <= 0)) return setError("Enter a valid custom payment amount.");
    if (!signatureDataUrl) return setError("Draw and save your signature before reviewing the reservation.");
    if (!acceptTerms) return setError("Accept the rental terms and privacy policy to continue.");
    setReviewBusy(true);
    setError("");
    try {
      const liveQuote = await fetchPricingQuote({
        vehicleId: vehicle.id,
        pickupDate,
        returnDate,
        customerEmail: email,
        insuranceSelected,
        insurancePlanId: insuranceSelected ? insurance?.planId : null,
        deliverySelected,
        deliveryZoneLabel,
        promoCode: promo?.code || null,
        paymentOption,
        customAmount: paymentOption === "CUSTOM" ? customAmount : null,
      });
      setQuote(liveQuote);
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Unable to generate the live reservation review.");
    } finally {
      setReviewBusy(false);
    }
  };

  const confirmBooking = async () => {
    if (!quote || !vehicle || !pickupLocation || !dropoffLocation || !signatureDataUrl) return setError("Review the reservation before confirming it.");
    setBookingBusy(true);
    setError("");
    try {
      const turnstileToken = await completeBookingSecurityChallenge();
      const result = await createBooking({
        vehicleId: vehicle.id,
        fullName,
        email,
        phone,
        startDate: pickupDate,
        endDate: returnDate,
        pickupLocation,
        dropoffLocation,
        pickupAddress,
        dropoffAddress,
        insuranceSelected,
        insurancePlanId: insuranceSelected ? insurance?.planId || null : null,
        signatureDataUrl,
        turnstileToken,
        promoCode: promo?.code || null,
        paymentOption,
        customPaymentAmount: paymentOption === "CUSTOM" ? customAmount : null,
      });
      await saveCurrentBooking(result, {
        vehicleName: vehicle.name,
        startDate: pickupDate,
        endDate: returnDate,
      });
      setBookingResult(result);
      if (paymentOption === "NONE") {
        setBookingStatus(await selectPayOnPickup(result.bookingId, result.bookingAccessToken));
      }
      setPage(3);
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Unable to create the reservation.");
    } finally {
      setBookingBusy(false);
    }
  };

  const continueToPayment = async () => {
    if (!bookingResult || paymentOption === "NONE") return;
    setPaymentBusy(true);
    setError("");
    try {
      setBookingStatus(await startBookingPayment(
        bookingResult.bookingId,
        bookingResult.bookingAccessToken,
        paymentOption,
        paymentOption === "CUSTOM" ? customAmount : null,
      ));
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start secure payment.");
    } finally {
      setPaymentBusy(false);
    }
  };

  return (
    <Screen scrollRef={screenRef}>
      <PageIntro eyebrow="Simple, secure booking" title="Reserve Your Ride" description="Live availability, transparent pricing, and local support—all in a guided three-page experience." />
      <WizardProgress page={page} onNavigate={(nextPage) => {
        if (page === 2 && nextPage === 1) {
          setQuote(null);
          setError("");
          setPage(1);
        }
      }} />
      {page === 1 ? (
        <>
          <TrustStrip labels={["Live availability", "Clear JMD pricing", "Secure checkout"]} />
          {fleetError ? <View style={styles.pagePad}><Notice error>{fleetError}</Notice></View> : null}

          <Card><StepHeader number={1} title="Choose your dates" body={`Minimum rental: ${minimumDays} ${minimumDays === 1 ? "day" : "days"}`} />
            <CalendarPicker pickupDate={pickupDate} returnDate={returnDate} minimumDays={minimumDays} onChange={changeDates} />
          </Card>

          <Card><StepHeader number={2} title="Select your vehicle" body={pickupDate && returnDate ? "Showing vehicles available for your trip." : "Select dates first, then we will refresh availability."} />
            {fleetLoading || availabilityBusy ? <Loading label="Refreshing live fleet…" /> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleRow}>
              {availableVehicles.map((item) => (
                <Pressable key={item.id} onPress={() => { setVehicleId(item.id); setPromo(null); invalidateReview(); }} style={[styles.vehicleCard, selectedVehicleId === item.id && styles.vehicleCardActive]} accessibilityRole="radio" accessibilityState={{ checked: selectedVehicleId === item.id }}>
                  <Image source={item.images[0]} style={styles.vehicleImage} contentFit="cover" accessibilityLabel={item.name} />
                  <View style={styles.vehicleBody}>
                    <View style={styles.vehicleBadgeRow}><Text style={[styles.liveBadge, item.source !== "live" && styles.estimateBadge]}>{item.source === "live" ? "LIVE" : "ESTIMATE"}</Text><Text style={styles.vehicleCategory}>{item.category}</Text></View>
                    <Text style={styles.vehicleTitle}>{item.name}</Text>
                    <Text style={styles.vehicleMeta}>{item.seats} seats · {item.bags} bags · {item.transmission}</Text>
                    <Text style={styles.vehiclePrice}>{formatJmd(item.dailyRate)}<Text style={styles.perDay}> / day</Text></Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            {!fleetLoading && availableVehicles.length === 0 ? <Notice error>No live vehicles match this trip yet.</Notice> : null}
          </Card>

          <Card><StepHeader number={3} title="Pickup and return" body="Choose convenient collection and return points." />
            <LocationChoices label="Pickup" locations={locations.filter((item) => item.allowPickup)} selectedId={pickupLocationId} getLabel={(item) => item.pickupLabel} onSelect={(id) => { setPickupLocationId(id); invalidateReview(); }} />
            {pickupLocation?.locationTypeKey === "CUSTOM_ADDRESS" ? <Field label="Pickup address" value={pickupAddress} onChangeText={(value) => { setPickupAddress(value); invalidateReview(); }} autoComplete="street-address" /> : null}
            <LocationChoices label="Return" locations={locations.filter((item) => item.allowDropoff)} selectedId={dropoffLocationId} getLabel={(item) => item.dropoffLabel} onSelect={(id) => { setDropoffLocationId(id); invalidateReview(); }} />
            {dropoffLocation?.locationTypeKey === "CUSTOM_ADDRESS" ? <Field label="Return address" value={dropoffAddress} onChangeText={(value) => { setDropoffAddress(value); invalidateReview(); }} autoComplete="street-address" /> : null}
          </Card>

          <Card><StepHeader number={4} title="Add protection" body="Choose the coverage that fits your trip." />
            {insurance?.enabled ? (
              <Pressable onPress={() => { setInsuranceSelected((current) => !current); setPromo(null); invalidateReview(); }} style={[styles.optionCard, insuranceSelected && styles.optionCardActive]} accessibilityRole="checkbox" accessibilityState={{ checked: insuranceSelected }}>
                <View style={[styles.optionCheck, insuranceSelected && styles.optionCheckActive]}><Text style={styles.optionCheckText}>{insuranceSelected ? "✓" : ""}</Text></View>
                <View style={styles.optionContent}><Text style={styles.optionTitle}>Standard protection</Text><Text style={styles.optionBody}>{formatJmd(insurance.pricePerDay)} per day · Coverage up to {formatJmd(insurance.coverage)}</Text></View>
              </Pressable>
            ) : <Notice>Protection options will be confirmed with your live quote.</Notice>}
            <Text style={styles.skipText}>{insuranceSelected ? "Protection added to this trip." : "You can continue without optional protection."}</Text>
          </Card>

          <ActionCard title="Trip setup complete" body={vehicle ? `${vehicle.name} · ${days || "—"} days · ${pickupLocation?.pickupLabel || "Choose pickup"}` : "Complete the four steps above."}>
            <Button label={availabilityBusy ? "Checking availability…" : "Continue to your details"} onPress={() => void continueToDetails()} disabled={availabilityBusy || fleetLoading} />
            {error ? <Notice error>{error}</Notice> : null}
          </ActionCard>
        </>
      ) : null}

      {page === 2 ? (
        <>
          <PageSummary vehicle={vehicle} pickupDate={pickupDate} returnDate={returnDate} days={days} onEdit={() => { setQuote(null); setPage(1); }} />

          <Card><StepHeader number={5} title="Your details" body="We will use these details for your agreement and trip updates." />
            <Field label="Full name" value={fullName} onChangeText={(value) => { setFullName(value); invalidateReview(); }} autoComplete="name" placeholder="As shown on your ID" />
            <Field label="Email" value={email} onChangeText={(value) => { setEmail(value); setPromo(null); invalidateReview(); }} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Field label="Phone" value={phone} onChangeText={(value) => { setPhone(value); invalidateReview(); }} keyboardType="phone-pad" autoComplete="tel" />
          </Card>

          <Card><StepHeader number={6} title="Promo code" body="Have an offer? Validate it against your live trip." />
            <Field label="Promo code" value={promoInput} onChangeText={(value) => { setPromoInput(value.toUpperCase()); setPromo(null); invalidateReview(); }} autoCapitalize="characters" placeholder="Enter code" />
            <View style={styles.inlineButtons}>
              <View style={styles.inlineButton}><Button label={promoBusy ? "Checking…" : promo ? "Recheck code" : "Apply promo"} onPress={() => void applyPromo()} disabled={promoBusy || !promoInput.trim()} secondary /></View>
              {promo ? <Pressable onPress={() => { setPromo(null); setPromoInput(""); invalidateReview(); }} style={styles.removeButton}><Text style={styles.removeButtonText}>Remove</Text></Pressable> : null}
            </View>
            {promo ? <Notice>{promo.code} applied · You save {formatJmd(promo.discountAmount)}</Notice> : null}
          </Card>

          <Card><StepHeader number={7} title="Choose how to pay" body="No card details are stored in the app. Online payments open WiPay securely." />
            <View style={styles.paymentGrid}>
              {PAYMENT_OPTIONS.map((item) => (
                <Pressable key={item.value} onPress={() => { setPaymentOption(item.value); invalidateReview(); }} style={[styles.paymentCard, paymentOption === item.value && styles.paymentCardActive]} accessibilityRole="radio" accessibilityState={{ checked: paymentOption === item.value }}>
                  <View style={styles.paymentTitleRow}><View style={[styles.radio, paymentOption === item.value && styles.radioActive]}>{paymentOption === item.value ? <View style={styles.radioDot} /> : null}</View><Text style={styles.paymentTitle}>{item.title}</Text></View>
                  <Text style={styles.paymentBody}>{item.body}</Text>
                </Pressable>
              ))}
            </View>
            {paymentOption === "CUSTOM" ? <Field label="Amount to pay now (JMD)" value={customPaymentAmount} onChangeText={(value) => { setCustomPaymentAmount(value); invalidateReview(); }} keyboardType="numeric" placeholder="e.g. 25000" /> : null}
          </Card>

          <Card><StepHeader number={8} title="Sign your reservation" body="Your signature confirms the trip information and rental-policy acknowledgement." />
            <SignaturePad onChange={(value) => { setSignatureDataUrl(value); invalidateReview(); }} />
            <Pressable onPress={() => { setAcceptTerms((current) => !current); invalidateReview(); }} style={styles.terms} accessibilityRole="checkbox" accessibilityState={{ checked: acceptTerms }}>
              <View style={[styles.optionCheck, acceptTerms && styles.optionCheckActive]}><Text style={styles.optionCheckText}>{acceptTerms ? "✓" : ""}</Text></View>
              <Text style={styles.termsText}>I accept the rental policies, payment terms, and privacy policy.</Text>
            </Pressable>
          </Card>

          <Card><StepHeader number={9} title="Review reservation" body="We will recheck live availability, promo, and pricing before anything is created." />
            {!quote ? <Button label={reviewBusy ? "Preparing live review…" : "Prepare reservation review"} onPress={() => void reviewReservation()} disabled={reviewBusy} /> : null}
            {reviewBusy ? <Loading label="Calculating your final live quote…" /> : null}
            {quote && vehicle ? (
              <View style={styles.quote}>
                <ReviewRow label="Vehicle" value={vehicle.name} />
                <ReviewRow label="Trip" value={`${days} days · ${pickupDate} → ${returnDate}`} />
                <ReviewRow label="Pickup" value={pickupLocation?.pickupLabel || "—"} />
                <ReviewRow label="Rental" value={formatJmd(quote.baseTotal)} />
                {quote.insuranceTotal > 0 ? <ReviewRow label="Protection" value={formatJmd(quote.insuranceTotal)} /> : null}
                {quote.discountTotal > 0 ? <ReviewRow label={`Promo ${quote.promoCode || ""}`} value={`−${formatJmd(quote.discountTotal)}`} success /> : null}
                <View style={styles.divider} />
                <ReviewRow label="Trip total" value={formatJmd(quote.total)} strong />
                <ReviewRow label={paymentOption === "NONE" ? "Due at pickup" : "Due now"} value={formatJmd(paymentOption === "NONE" ? quote.balanceDue : quote.dueNow)} strong />
                {paymentOption !== "FULL" && paymentOption !== "NONE" ? <ReviewRow label="Remaining at pickup" value={formatJmd(quote.dueOnPickup)} /> : null}
                <Notice>Live availability and pricing verified. Your booking is not created until you confirm below.</Notice>
                <Button label={bookingBusy ? "Opening secure confirmation…" : "Confirm reservation"} onPress={() => void confirmBooking()} disabled={bookingBusy} />
              </View>
            ) : null}
            {error ? <Notice error>{error}</Notice> : null}
            <Button label="Back to trip setup" onPress={() => { setQuote(null); setPage(1); }} secondary />
          </Card>
        </>
      ) : null}

      {page === 3 ? (
        <>
          <View style={styles.paymentHero}>
            <View style={styles.successIcon}><Text style={styles.successIconText}>✓</Text></View>
            <Text style={styles.paymentEyebrow}>RESERVATION CREATED</Text>
            <Text style={styles.paymentHeroTitle}>{paymentOption === "NONE" ? "You’re booked" : "One last secure step"}</Text>
            <Text style={styles.paymentHeroBody}>{paymentOption === "NONE" ? "Your vehicle is reserved and the balance is due at pickup." : "Continue to WiPay to complete your selected payment. You will return here to see the confirmed status."}</Text>
          </View>
          <Card>
            <Text style={styles.confirmationLabel}>BOOKING REFERENCE</Text>
            <Text style={styles.confirmationReference}>{bookingStatus?.reference || bookingResult?.bookingId.slice(0, 8).toUpperCase()}</Text>
            <ReviewRow label="Vehicle" value={vehicle?.name || "Reserved vehicle"} />
            <ReviewRow label="Trip total" value={formatJmd(quote?.total || 0)} />
            <ReviewRow label="Payment choice" value={PAYMENT_OPTIONS.find((item) => item.value === paymentOption)?.title || paymentOption} />
            {bookingStatus ? <ReviewRow label="Status" value={bookingStatus.paymentStatus.replaceAll("_", " ")} strong /> : null}
            {paymentOption !== "NONE" ? <Button label={paymentBusy ? "Checking payment status…" : "Continue to WiPay"} onPress={() => void continueToPayment()} disabled={paymentBusy || bookingStatus?.paymentStatus === "DEPOSIT_PAID" || bookingStatus?.paymentStatus === "PAID_IN_FULL"} /> : null}
            <Button label="View My Booking" href="/booking-status" secondary />
            {error ? <Notice error>{error}</Notice> : null}
          </Card>
          <Card style={styles.secureCard}><Text style={styles.secureTitle}>Secure by design</Text><Text style={styles.secureBody}>WiPay handles card details on its hosted checkout. Curated Car Rentals receives only the payment result needed to update your reservation.</Text></Card>
        </>
      ) : null}
    </Screen>
  );
}

function WizardProgress({ page, onNavigate }: { page: WizardPage; onNavigate: (page: WizardPage) => void }) {
  const { styles } = useBookingStyles();
  const items = [{ page: 1, title: "Trip" }, { page: 2, title: "Details" }, { page: 3, title: "Pay" }] as const;
  return <View style={styles.progress}>{items.map((item, index) => {
    const canNavigate = page === 2 && item.page === 1;
    return <View key={item.page} style={styles.progressItem}>
      <Pressable onPress={() => canNavigate && onNavigate(item.page)} disabled={!canNavigate} style={styles.progressButton} accessibilityRole="button" accessibilityLabel={`${item.title}, step ${item.page}${canNavigate ? ", completed, go back" : ""}`} accessibilityState={{ selected: page === item.page, disabled: !canNavigate }}>
        <View style={[styles.progressCircle, page >= item.page && styles.progressCircleActive, canNavigate && styles.progressCircleNavigable]}><Text style={[styles.progressNumber, page >= item.page && styles.progressNumberActive]}>{page > item.page ? "✓" : item.page}</Text></View>
        <Text style={[styles.progressLabel, page === item.page && styles.progressLabelActive, canNavigate && styles.progressLabelNavigable]}>{item.title}</Text>
      </Pressable>
      {index < items.length - 1 ? <View style={[styles.progressLine, page > item.page && styles.progressLineActive]} /> : null}
    </View>;
  })}</View>;
}

function TrustStrip({ labels }: { labels: string[] }) {
  const { styles } = useBookingStyles();
  return <View style={styles.trustStrip}>{labels.map((label) => <View key={label} style={styles.trustItem}><Text style={styles.trustCheck}>✓</Text><Text style={styles.trustText}>{label}</Text></View>)}</View>;
}

function StepHeader({ number, title, body }: { number: number; title: string; body: string }) {
  const { styles } = useBookingStyles();
  return <View style={styles.stepHeader}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><View style={styles.stepHeaderContent}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.stepBody}>{body}</Text></View></View>;
}

function Loading({ label }: { label: string }) {
  const { colors, styles } = useBookingStyles();
  return <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>{label}</Text></View>;
}

function LocationChoices({ label, locations, selectedId, getLabel, onSelect }: { label: string; locations: BookingLocation[]; selectedId: string; getLabel: (location: BookingLocation) => string; onSelect: (id: string) => void }) {
  const { styles } = useBookingStyles();
  return <View style={styles.locationSection}><Text style={styles.fieldHeading}>{label}</Text><View style={styles.chips}>{locations.map((item) => <Pressable key={`${label}-${item.id}`} onPress={() => onSelect(item.id)} style={[styles.chip, selectedId === item.id && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ checked: selectedId === item.id }}><Text style={[styles.chipText, selectedId === item.id && styles.chipTextActive]}>{getLabel(item)}</Text></Pressable>)}</View></View>;
}

function ActionCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const { styles } = useBookingStyles();
  return <View style={styles.actionCard}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionBody}>{body}</Text>{children}</View>;
}

function PageSummary({ vehicle, pickupDate, returnDate, days, onEdit }: { vehicle?: Vehicle; pickupDate: string; returnDate: string; days: number; onEdit: () => void }) {
  const { styles } = useBookingStyles();
  return <View style={styles.pageSummary}><View style={styles.pageSummaryContent}><Text style={styles.pageSummaryLabel}>YOUR TRIP</Text><Text style={styles.pageSummaryTitle}>{vehicle?.name || "Selected vehicle"}</Text><Text style={styles.pageSummaryBody}>{pickupDate} → {returnDate} · {days} days</Text></View><Pressable onPress={onEdit} style={styles.editButton} accessibilityRole="button"><Text style={styles.editButtonText}>Edit</Text></Pressable></View>;
}

function ReviewRow({ label, value, strong = false, success = false }: { label: string; value: string; strong?: boolean; success?: boolean }) {
  const { styles } = useBookingStyles();
  return <View style={styles.reviewRow}><Text style={[styles.reviewLabel, strong && styles.reviewStrong]}>{label}</Text><Text style={[styles.reviewValue, strong && styles.reviewStrong, success && styles.reviewSuccess]}>{value}</Text></View>;
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  pagePad: { paddingHorizontal: 20 },
  progress: { flexDirection: "row", paddingHorizontal: 30, paddingVertical: 20, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  progressItem: { flex: 1, alignItems: "center", position: "relative" },
  progressButton: { alignItems: "center", zIndex: 3 },
  progressCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, zIndex: 2 },
  progressCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  progressCircleNavigable: { borderWidth: 2, borderColor: colors.orange },
  progressNumber: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  progressNumberActive: { color: colors.white },
  progressLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 6 },
  progressLabelActive: { color: colors.tealDark, fontWeight: "900" },
  progressLabelNavigable: { color: colors.orange, textDecorationLine: "underline" },
  progressLine: { position: "absolute", left: "66%", right: "-34%", top: 15, height: 2, backgroundColor: colors.border, zIndex: 1 },
  progressLineActive: { backgroundColor: colors.teal },
  trustStrip: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: isDark ? colors.navySoft : "#ECF7F3" },
  trustItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  trustCheck: { color: colors.teal, fontSize: 11, fontWeight: "900" },
  trustText: { color: colors.tealDark, fontSize: 9, fontWeight: "800" },
  stepHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNumber: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? colors.navySoft : "#FFF0E8" },
  stepNumberText: { color: colors.orangeDark, fontSize: 14, fontWeight: "900" },
  stepHeaderContent: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 20, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  stepBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  loading: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 15 },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  vehicleRow: { gap: 12, paddingTop: 16, paddingBottom: 4 },
  vehicleCard: { width: 236, overflow: "hidden", borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  vehicleCardActive: { borderColor: colors.teal, backgroundColor: isDark ? colors.navySoft : "#F2FAF7" },
  vehicleImage: { width: "100%", height: 128, backgroundColor: colors.surfaceSoft },
  vehicleBody: { padding: 14 },
  vehicleBadgeRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveBadge: { color: colors.tealDark, backgroundColor: isDark ? colors.surfaceSoft : "#DDF2EA", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  estimateBadge: { color: colors.orangeDark, backgroundColor: isDark ? colors.surfaceSoft : "#FFF0E8" },
  vehicleCategory: { color: colors.orangeDark, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  vehicleTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 9 },
  vehicleMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  vehiclePrice: { color: colors.tealDark, fontSize: 17, fontWeight: "900", marginTop: 11 },
  perDay: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  locationSection: { marginTop: 18 },
  fieldHeading: { color: colors.text, fontSize: 13, fontWeight: "900", marginBottom: 9 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { maxWidth: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: colors.surfaceSoft },
  chipActive: { borderColor: colors.teal, backgroundColor: colors.teal },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: colors.white },
  optionCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 16, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, padding: 14, backgroundColor: colors.surfaceSoft },
  optionCardActive: { borderColor: colors.teal, backgroundColor: isDark ? colors.navySoft : "#ECF7F3" },
  optionCheck: { width: 23, height: 23, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  optionCheckActive: { borderColor: colors.teal, backgroundColor: colors.teal },
  optionCheckText: { color: colors.white, fontSize: 13, fontWeight: "900" },
  optionContent: { flex: 1 },
  optionTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  optionBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  skipText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 12 },
  actionCard: { marginHorizontal: 20, marginBottom: 22, borderRadius: radii.lg, padding: 20, backgroundColor: colors.navy, ...shadow },
  actionTitle: { color: colors.white, fontSize: 21, fontWeight: "900" },
  actionBody: { color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 20, marginTop: 7 },
  pageSummary: { flexDirection: "row", alignItems: "center", gap: 12, margin: 20, padding: 16, borderRadius: radii.lg, backgroundColor: colors.navy },
  pageSummaryContent: { flex: 1 },
  pageSummaryLabel: { color: "#9FE3CB", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  pageSummaryTitle: { color: colors.white, fontSize: 17, fontWeight: "900", marginTop: 5 },
  pageSummaryBody: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 5 },
  editButton: { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  editButtonText: { color: colors.white, fontSize: 11, fontWeight: "800" },
  inlineButtons: { flexDirection: "row", alignItems: "center", gap: 12 },
  inlineButton: { flex: 1 },
  removeButton: { marginTop: 18, paddingHorizontal: 10, paddingVertical: 14 },
  removeButtonText: { color: colors.danger, fontSize: 12, fontWeight: "800" },
  paymentGrid: { gap: 10, marginTop: 16 },
  paymentCard: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, padding: 14, backgroundColor: colors.surfaceSoft },
  paymentCardActive: { borderColor: colors.teal, backgroundColor: isDark ? colors.navySoft : "#ECF7F3" },
  paymentTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  radioActive: { borderColor: colors.teal },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal },
  paymentTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  paymentBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7, marginLeft: 30 },
  terms: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 18, padding: 14, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  termsText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 19, fontWeight: "700" },
  quote: { marginTop: 16, borderRadius: radii.md, padding: 16, backgroundColor: colors.cream },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginTop: 12 },
  reviewLabel: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  reviewValue: { maxWidth: "58%", color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: "800", textAlign: "right" },
  reviewStrong: { color: colors.tealDark, fontSize: 14, fontWeight: "900" },
  reviewSuccess: { color: colors.success },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 16 },
  paymentHero: { alignItems: "center", paddingHorizontal: 28, paddingVertical: 34, backgroundColor: colors.navy },
  successIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: colors.teal },
  successIconText: { color: colors.white, fontSize: 28, fontWeight: "900" },
  paymentEyebrow: { color: "#9FE3CB", fontSize: 10, fontWeight: "900", letterSpacing: 1.6, marginTop: 17 },
  paymentHeroTitle: { color: colors.white, fontSize: 31, lineHeight: 36, fontWeight: "900", textAlign: "center", marginTop: 7 },
  paymentHeroBody: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 10 },
  confirmationLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  confirmationReference: { color: colors.text, fontSize: 26, fontWeight: "900", marginTop: 5, marginBottom: 8 },
  secureCard: { backgroundColor: isDark ? colors.navySoft : "#ECF7F3", borderColor: colors.teal },
  secureTitle: { color: colors.tealDark, fontSize: 16, fontWeight: "900" },
  secureBody: { color: colors.tealDark, fontSize: 12, lineHeight: 19, marginTop: 7 },
});

import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";

import { Button, Card, Notice, PageIntro, Screen } from "@/components/primitives";
import { colors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { fetchBookingStatus, startDepositPayment, type BookingStatus } from "@/services/api";
import { clearCurrentBooking, getCurrentBooking, type SavedBooking } from "@/services/bookingStore";

export default function BookingStatusScreen() {
  const [booking, setBooking] = useState<SavedBooking | null>(null);
  const [status, setStatus] = useState<BookingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (savedBooking = booking) => {
    if (!savedBooking) return;
    setError("");
    try {
      setStatus(await fetchBookingStatus(savedBooking.bookingId, savedBooking.bookingAccessToken));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh this reservation.");
    }
  };

  useEffect(() => {
    let active = true;
    void getCurrentBooking().then(async (savedBooking) => {
      if (!active) return;
      setBooking(savedBooking);
      if (savedBooking) {
        try {
          const nextStatus = await fetchBookingStatus(savedBooking.bookingId, savedBooking.bookingAccessToken);
          if (active) setStatus(nextStatus);
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load this reservation.");
        }
      }
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const payDeposit = async () => {
    if (!booking) return;
    setPaymentBusy(true);
    setError("");
    try {
      setStatus(await startDepositPayment(booking.bookingId, booking.bookingAccessToken));
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start deposit payment.");
    } finally {
      setPaymentBusy(false);
    }
  };

  const forget = async () => {
    await clearCurrentBooking();
    setBooking(null);
    setStatus(null);
    setError("");
  };

  return (
    <Screen>
      <PageIntro eyebrow="Your reservation" title="My Booking" description="Review the latest reservation saved securely on this device and complete its deposit." />
      {loading ? <ActivityIndicator style={styles.loading} color={colors.teal} /> : null}
      {!loading && !booking ? (
        <Card>
          <Text style={styles.title}>No saved booking</Text>
          <Text style={styles.body}>Create a reservation in the Book tab. Its private access key will be encrypted on this device.</Text>
          <Button label="Start a reservation" href="/(tabs)/book" />
        </Card>
      ) : null}
      {booking ? (
        <Card>
          <Text style={styles.title}>Booking {status?.reference || booking.bookingId}</Text>
          <Row label="Reservation status" value={(status?.status || booking.status).replaceAll("_", " ")} />
          {status ? (
            <>
              <Row label="Payment status" value={status.paymentStatus.replaceAll("_", " ")} />
              <Row label="Total" value={formatJmd(status.total)} />
              <Row label="Paid" value={formatJmd(status.paidToDate)} />
              <Row label="Balance" value={formatJmd(status.balanceDue)} />
            </>
          ) : null}
          <Button label="Refresh status" onPress={() => void refresh()} secondary />
          <Button
            label={paymentBusy ? "Checking payment…" : "Pay deposit securely"}
            onPress={() => void payDeposit()}
            disabled={paymentBusy || status?.paymentStatus === "DEPOSIT_PAID" || status?.paymentStatus === "PAID_IN_FULL"}
          />
          <Button label="Remove from this device" onPress={() => void forget()} secondary />
          {error ? <Notice error>{error}</Notice> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <Text style={styles.row}><Text style={styles.label}>{label}: </Text>{value}</Text>;
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 10 },
  row: { color: colors.text, fontSize: 14, lineHeight: 23, marginTop: 9, textTransform: "capitalize" },
  label: { color: colors.muted, fontWeight: "700" },
});

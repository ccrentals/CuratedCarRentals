import { StyleSheet, Text } from "react-native";

import { Button, Card, PageIntro, Screen } from "@/components/primitives";
import { colors } from "@/constants/theme";

const sections = [
  ["Information we collect", "Reservations may include your name, email, phone, rental details, selected locations or delivery address, signature, and communications. Identity, driver’s licence, insurance, or verification details may be collected when required to complete a rental."],
  ["How we use it", "Information is used to quote and administer rentals, process and reconcile payments, arrange pickup or delivery, provide support, prevent abuse, keep required business records, and comply with legal obligations. Curated Car Rentals does not sell personal information or use this app for third-party behavioural advertising."],
  ["Payments and security", "Card details are entered on WiPay’s hosted payment service and are not collected by this app. Cloudflare Turnstile processes technical information for abuse prevention. The app does not request precise location, contacts, photos, microphone, or advertising identifiers."],
  ["On-device storage", "The app stores a private booking-access credential in Android encrypted secure storage so My Booking can retrieve your reservation status. You can remove it from My Booking. Removing local data does not cancel a reservation or delete company records."],
  ["Retention and your choices", "Records are retained only as reasonably necessary for rentals, transactions, disputes, fraud prevention, and legal, tax, insurance, or accounting requirements. You may request access, correction, or deletion, subject to identity verification and records we must retain."],
] as const;

export default function PrivacyScreen() {
  return (
    <Screen>
      <PageIntro eyebrow="Website and Android app" title="Privacy Policy" description="How Curated Car Rentals handles information used for reservations, payments, and support." />
      <Card>
        <Text style={styles.updated}>Last updated: July 14, 2026</Text>
        {sections.map(([title, body]) => (
          <Text key={title} style={styles.section}>
            <Text style={styles.title}>{title}{"\n"}</Text>
            {body}
          </Text>
        ))}
        <Text style={styles.section}>
          <Text style={styles.title}>Contact{"\n"}</Text>
          Email info@curatedcarrentals.com, call +1 (876) 379-7163, or write to 166 Old Hope Road, Kingston, Jamaica.
        </Text>
        <Button label="Read policy on the website" href="https://curatedcarrentals.com/privacy" secondary />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  updated: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  section: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 18 },
  title: { color: colors.text, fontSize: 18, fontWeight: "900", lineHeight: 27 },
});

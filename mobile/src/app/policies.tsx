import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Card, PageIntro, Screen } from "@/components/primitives";
import { useAppTheme } from "@/components/ThemeProvider";
import type { AppColors } from "@/constants/theme";

const sections = [
  { title: "Driver requirements", items: ["Drivers must be 23 years or older.", "A driver's licence must be valid for at least one year and in good standing.", "Two valid forms of identification are required."] },
  { title: "Security deposit", items: ["Every rental requires a refundable security deposit.", "Deposits start at JMD $15,000 and depend on vehicle class.", "The deposit is refunded after the vehicle is returned in the same condition."] },
  { title: "Insurance choices", items: ["Choose collision coverage and remain responsible for the applicable deductible.", "If coverage is declined, the renter is responsible for damage up to the vehicle's value and associated loss of use."] },
  { title: "Paid reservation", items: ["Your booking and selected vehicle are secured after the required reservation payment.", "The payment counts toward your rental total.", "Kingston airport pickup is available with a paid reservation."] },
];

export default function PoliciesScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return (
    <Screen>
      <PageIntro eyebrow="Clear rental terms" title="Rental Policies" description="Review the key requirements, deposit, insurance and reservation terms before booking." />
      {sections.map((section) => <Card key={section.title}><Text style={styles.title}>{section.title}</Text>{section.items.map((item) => <View style={styles.item} key={item}><Text style={styles.check}>✓</Text><Text style={styles.body}>{item}</Text></View>)}</Card>)}
      <Card style={styles.notice}><Text style={styles.noticeTitle}>Airport pickup policy</Text><Text style={styles.noticeBody}>Free pickup from Norman Manley International Airport is provided only with a paid reservation. Availability is not guaranteed until the required reservation payment is complete.</Text><Button label="Reserve a vehicle" href="/(tabs)/book" /></Card>
    </Screen>
  );
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: "900", marginBottom: 6 },
  item: { flexDirection: "row", gap: 10, marginTop: 13 },
  check: { color: colors.teal, fontSize: 16, fontWeight: "900" },
  body: { flex: 1, color: colors.muted, fontSize: 15, lineHeight: 23 },
  notice: { backgroundColor: isDark ? colors.navySoft : "#EAF7F1", borderColor: colors.teal },
  noticeTitle: { color: colors.tealDark, fontSize: 21, fontWeight: "900" },
  noticeBody: { color: colors.tealDark, fontSize: 15, lineHeight: 23, marginTop: 10 },
});

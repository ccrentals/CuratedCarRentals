import { StyleSheet, Text } from "react-native";

import { Button, Card, PageIntro, Screen } from "@/components/primitives";
import { colors } from "@/constants/theme";
import { drivingTips } from "@/data/catalog";

export default function DrivingScreen() {
  return (
    <Screen>
      <PageIntro eyebrow="Island road guide" title="Driving in Jamaica" description="Essential information for a safe and enjoyable driving experience on the island." />
      {drivingTips.map((item) => <Card key={item.title}><Text style={styles.title}>{item.title}</Text><Text style={styles.body}>{item.text}</Text></Card>)}
      <Card style={styles.cta}><Text style={styles.ctaTitle}>Ready for your Jamaican road trip?</Text><Text style={styles.ctaBody}>Choose a comfortable vehicle and reserve your dates.</Text><Button label="Book your car" href="/(tabs)/book" /></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 21, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 24, marginTop: 10 },
  cta: { backgroundColor: colors.navy, borderColor: colors.navy },
  ctaTitle: { color: colors.white, fontSize: 25, fontWeight: "900" },
  ctaBody: { color: "rgba(255,255,255,0.72)", fontSize: 15, lineHeight: 23, marginTop: 10 },
});

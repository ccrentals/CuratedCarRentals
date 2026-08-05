import { Image } from "expo-image";
import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";

import { Button, Card, PageIntro, Screen, SectionTitle } from "@/components/primitives";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const features = ["Premium Insurance", "24/7 Support", "Well-Maintained Fleet", "Convenient Kingston Location", "Personal Service", "Local Expertise"];

export default function AboutScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Screen>
      <PageIntro eyebrow="Our story" title="About Curated" description="Exceptional vehicles and personal service for business trips, family visits and Jamaican adventures." />
      <Image source={require("../../assets/home/discover-jamaica.png")} style={styles.image} contentFit="cover" accessibilityLabel="Discover Jamaica" />
      <SectionTitle eyebrow="About us" title="Your Premier Car Rental Experience in Kingston" description="Our carefully selected fleet combines comfort, style and reliability. From first contact to return, our local team works to make every rental feel clear and seamless." />
      {features.map((feature) => <Card key={feature}><Text style={styles.feature}>✓  {feature}</Text></Card>)}
      <Card style={styles.mission}><Text style={styles.missionTitle}>Our Mission</Text><Text style={styles.missionBody}>We help visitors explore Jamaica on their own terms with dependable vehicles, transparent pricing and responsive local support. We believe the right rental should make the journey easier—not add stress to it.</Text><Button label="Start your reservation" href="/(tabs)/book" /></Card>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  image: { height: 290, margin: 20, borderRadius: radii.lg },
  feature: { color: colors.text, fontSize: 17, fontWeight: "700" },
  mission: { backgroundColor: colors.cream, borderColor: colors.sand },
  missionTitle: { color: colors.text, fontSize: 25, fontWeight: "900" },
  missionBody: { color: colors.muted, fontSize: 15, lineHeight: 24, marginTop: 12 },
});

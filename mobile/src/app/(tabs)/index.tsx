import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { useAppTheme } from "@/components/ThemeProvider";
import { Button, Card, Screen, SectionTitle } from "@/components/primitives";
import { radii, shadow, type AppColors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";

const benefits = [
  { icon: "◇", title: "Handpicked fleet", body: "Reliable vehicles selected for Jamaican roads." },
  { icon: "✦", title: "Local support", body: "Real people ready to help throughout your trip." },
  { icon: "✓", title: "Clear pricing", body: "Know your rental total before you reserve." },
];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { vehicles } = useFleet();
  const featured = vehicles.slice(0, 4);
  const [activeVehicle, setActiveVehicle] = useState(0);
  const cardWidth = Math.min(width - 40, 430);

  const updateActiveVehicle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 12));
    setActiveVehicle(Math.max(0, Math.min(featured.length - 1, nextIndex)));
  };

  return (
    <Screen dark>
      <StatusBar style="light" />
      <View style={styles.hero}>
        <Image source={require("../../../assets/home/hero-tropical-car.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Car on a tropical road in Jamaica" />
        <View style={styles.overlay} />
        <View style={styles.heroGlow} />
        <View style={styles.logo}><BrandLogo light size={60} /></View>
        <View style={styles.heroContent}>
          <View style={styles.locationPill}><Text style={styles.location}>KINGSTON, JAMAICA</Text></View>
          <Text style={styles.title}>Your island journey starts here.</Text>
          <Text style={styles.body}>A curated vehicle, transparent pricing, and Jamaican support from pickup to return.</Text>
          <Button label="Find my vehicle" href="/(tabs)/book" />
          <View style={styles.heroPromise}>
            <Text style={styles.heroPromiseIcon}>✓</Text>
            <Text style={styles.heroPromiseText}>Live availability · Secure reservation</Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.benefits}>
          {benefits.map((item) => (
            <View key={item.title} style={styles.benefit}>
              <View style={styles.benefitIcon}><Text style={styles.benefitIconText}>{item.icon}</Text></View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{item.title}</Text>
                <Text style={styles.benefitBody}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <SectionTitle eyebrow="Featured fleet" title="Made for your kind of trip" description="Swipe through popular choices, then check live availability for your dates." />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + 12}
          snapToAlignment="start"
          decelerationRate="fast"
          onMomentumScrollEnd={updateActiveVehicle}
          contentContainerStyle={styles.carousel}
        >
          {featured.map((vehicle) => (
            <View key={vehicle.id} style={[styles.vehicleCard, { width: cardWidth }]}>
              <Image source={vehicle.images[0]} style={styles.vehicleImage} contentFit="cover" transition={180} accessibilityLabel={vehicle.name} />
              <View style={styles.imageShade} />
              <View style={styles.categoryPill}><Text style={styles.categoryText}>{vehicle.category.toUpperCase()}</Text></View>
              <View style={styles.vehicleBody}>
                <View style={styles.vehicleTitleRow}>
                  <View style={styles.vehicleTitleCopy}>
                    <Text style={styles.vehicleTitle}>{vehicle.name}</Text>
                    <Text style={styles.vehicleMeta}>{vehicle.transmission} · {vehicle.seats} seats · {vehicle.bags} bags</Text>
                  </View>
                  <View style={styles.rateBlock}>
                    <Text style={styles.rate}>{formatJmd(vehicle.dailyRate)}</Text>
                    <Text style={styles.rateLabel}>per day</Text>
                  </View>
                </View>
                <Button label="View vehicle" href={{ pathname: "/fleet/[id]", params: { id: vehicle.id } }} secondary />
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.carouselFooter}>
          <View style={styles.dots}>
            {featured.map((vehicle, index) => <View key={vehicle.id} style={[styles.dot, index === activeVehicle && styles.dotActive]} />)}
          </View>
          <Button label="Explore complete fleet" href="/(tabs)/fleet" secondary />
        </View>

        <Card style={styles.discover}>
          <Image source={require("../../../assets/home/discover-jamaica.png")} style={styles.discoverImage} contentFit="cover" accessibilityLabel="Discover Jamaica" />
          <View style={styles.discoverShade} />
          <View style={styles.discoverCopy}>
            <Text style={styles.discoverEyebrow}>BEYOND THE RENTAL</Text>
            <Text style={styles.discoverTitle}>Discover Jamaica</Text>
            <Text style={styles.discoverBody}>Scenic drives, local favourites, and practical island guidance—all in your pocket.</Text>
            <Button label="Plan an island drive" href="/destinations" secondary />
          </View>
        </Card>

        <View style={styles.footer}>
          <BrandLogo compact size={34} />
          <Text style={styles.footerText}>Curated Car Rentals · Kingston, Jamaica</Text>
          <Text style={styles.footerMeta}>© {new Date().getFullYear()} · Drive beautifully.</Text>
        </View>
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  hero: { minHeight: 650, paddingHorizontal: 22, paddingTop: 30, paddingBottom: 42, justifyContent: "flex-end", backgroundColor: colors.navy, overflow: "hidden" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(5,15,28,0.64)" },
  heroGlow: { position: "absolute", width: 310, height: 310, borderRadius: 155, right: -160, bottom: 40, backgroundColor: "rgba(234,114,66,0.18)" },
  logo: { position: "absolute", top: 24, left: 20 },
  heroContent: { maxWidth: 510 },
  locationPill: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(39,117,95,0.78)", borderWidth: 1, borderColor: "rgba(159,227,203,0.45)" },
  location: { color: "#C5F5E3", fontSize: 10, fontWeight: "900", letterSpacing: 1.7 },
  title: { color: colors.white, fontSize: 43, lineHeight: 47, fontWeight: "900", letterSpacing: -1.4, marginTop: 16 },
  body: { color: "rgba(255,255,255,0.84)", fontSize: 17, lineHeight: 26, marginTop: 15 },
  heroPromise: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14 },
  heroPromiseIcon: { color: "#9FE3CB", fontSize: 12, fontWeight: "900" },
  heroPromiseText: { color: "rgba(255,255,255,0.74)", fontSize: 11, fontWeight: "700" },
  content: { backgroundColor: colors.surfaceSoft, paddingBottom: 8 },
  benefits: { marginHorizontal: 20, marginTop: -22, borderRadius: radii.lg, padding: 17, gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  benefit: { flexDirection: "row", alignItems: "center", gap: 12 },
  benefitIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? colors.navySoft : "#ECF7F3" },
  benefitIconText: { color: colors.teal, fontSize: 17, fontWeight: "900" },
  benefitCopy: { flex: 1 },
  benefitTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  benefitBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  carousel: { gap: 12, paddingHorizontal: 20, paddingBottom: 6 },
  vehicleCard: { overflow: "hidden", borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  vehicleImage: { width: "100%", height: 220, backgroundColor: colors.navySoft },
  imageShade: { position: "absolute", top: 130, left: 0, right: 0, height: 90, backgroundColor: "rgba(7,17,31,0.22)" },
  categoryPill: { position: "absolute", top: 14, left: 14, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(7,17,31,0.82)" },
  categoryText: { color: colors.white, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  vehicleBody: { padding: 18 },
  vehicleTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  vehicleTitleCopy: { flex: 1 },
  vehicleTitle: { color: colors.text, fontSize: 21, lineHeight: 25, fontWeight: "900" },
  vehicleMeta: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  rateBlock: { alignItems: "flex-end" },
  rate: { color: colors.tealDark, fontSize: 16, fontWeight: "900" },
  rateLabel: { color: colors.muted, fontSize: 9, marginTop: 2 },
  carouselFooter: { marginHorizontal: 20, marginTop: 8, marginBottom: 28 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.orange },
  discover: { minHeight: 390, padding: 0, overflow: "hidden", justifyContent: "flex-end", backgroundColor: colors.navy },
  discoverImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  discoverShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(5,15,28,0.60)" },
  discoverCopy: { padding: 22 },
  discoverEyebrow: { color: "#9FE3CB", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  discoverTitle: { color: colors.white, fontSize: 29, fontWeight: "900", marginTop: 8 },
  discoverBody: { color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 22, marginTop: 8 },
  footer: { alignItems: "center", marginHorizontal: 20, paddingVertical: 24, borderTopWidth: 1, borderTopColor: colors.border },
  footerText: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 9 },
  footerMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
});

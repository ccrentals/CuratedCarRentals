import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { Button, Card, PhotoCard, Screen, SectionTitle } from "@/components/primitives";
import { colors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";

export default function HomeScreen() {
  const { vehicles } = useFleet();

  return (
    <Screen dark>
      <View style={styles.hero}>
        <Image source={require("../../../assets/home/hero-tropical-car.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Car on a tropical road in Jamaica" />
        <View style={styles.overlay} />
        <Image source={require("../../../assets/brand/logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="Curated Car Rentals" />
        <Text style={styles.location}>KINGSTON, JAMAICA</Text>
        <Text style={styles.title}>Experience Jamaica&apos;s Beauty</Text>
        <Text style={styles.body}>Explore Kingston and beyond with a carefully selected, reliable vehicle and local support.</Text>
        <Button label="Book Your Vehicle" href="/(tabs)/book" />
        <Button label="Explore Our Fleet" href="/(tabs)/fleet" secondary />
      </View>

      <View style={styles.pricing}><Text style={styles.pricingText}>Simple pricing includes all fees and taxes. Optional insurance is extra.</Text></View>

      <SectionTitle eyebrow="Featured fleet" title="Our Curated Collection" description="Comfortable vehicles selected for city trips, business travel and island adventures." />
      {vehicles.slice(0, 3).map((vehicle) => (
        <PhotoCard
          key={vehicle.id}
          image={vehicle.images[0]}
          eyebrow={vehicle.category}
          title={vehicle.name}
          body={`${vehicle.transmission}  •  ${vehicle.seats} seats  •  From ${formatJmd(vehicle.dailyRate)}/day`}
          action={<Button label="View vehicle" href={{ pathname: "/fleet/[id]", params: { id: vehicle.id } }} secondary />}
        />
      ))}

      <Card style={styles.discover}>
        <Image source={require("../../../assets/home/discover-jamaica.png")} style={styles.discoverImage} contentFit="cover" accessibilityLabel="Discover Jamaica" />
        <Text style={styles.discoverTitle}>Discover Jamaica</Text>
        <Text style={styles.discoverBody}>From Kingston&apos;s vibrant streets to scenic coastlines, your rental is a passport to the island.</Text>
        <Button label="Tourist destinations" href="/destinations" secondary />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 610, paddingHorizontal: 22, paddingTop: 30, paddingBottom: 40, justifyContent: "flex-end", backgroundColor: colors.navy },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(8,20,37,0.62)" },
  logo: { position: "absolute", top: 24, left: 20, width: 78, height: 78 },
  location: { color: "#9FE3CB", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  title: { color: colors.white, fontSize: 42, lineHeight: 46, fontWeight: "900", letterSpacing: -1.2, marginTop: 14 },
  body: { color: "rgba(255,255,255,0.88)", fontSize: 17, lineHeight: 26, marginTop: 16 },
  pricing: { backgroundColor: colors.sand, paddingHorizontal: 20, paddingVertical: 16 },
  pricingText: { color: "#4C3B16", textAlign: "center", fontSize: 14, lineHeight: 21, fontWeight: "600" },
  discover: { backgroundColor: colors.cream, padding: 0, overflow: "hidden" },
  discoverImage: { width: "100%", height: 230 },
  discoverTitle: { color: colors.text, fontSize: 26, fontWeight: "800", paddingHorizontal: 20, paddingTop: 20 },
  discoverBody: { color: colors.muted, fontSize: 15, lineHeight: 23, paddingHorizontal: 20, paddingTop: 8 },
});

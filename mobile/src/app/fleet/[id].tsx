import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Card, PageIntro, Screen } from "@/components/primitives";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";

export default function VehicleDetailScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { vehicles, loading } = useFleet();
  const vehicle = vehicles.find((item) => item.id === id);
  if (loading && !vehicle) return <Screen><PageIntro title="Loading vehicle" description="Checking the live fleet and current rate." /><ActivityIndicator color={colors.teal} size="large" /></Screen>;
  if (!vehicle) return <Screen><PageIntro title="Vehicle not found" description="This vehicle is no longer in the local catalogue." /><Card><Button label="Back to fleet" onPress={() => router.replace("/(tabs)/fleet")} /></Card></Screen>;

  return (
    <Screen dark>
      <PageIntro eyebrow={`${vehicle.category} • ${vehicle.year}`} title={vehicle.name} description={vehicle.description} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
        {vehicle.images.map((image, index) => <Image key={index} source={image} style={styles.image} contentFit="cover" accessibilityLabel={`${vehicle.name} view ${index + 1}`} />)}
      </ScrollView>
      <Card>
        <Text style={styles.price}>{formatJmd(vehicle.dailyRate)} <Text style={styles.perDay}>per day</Text></Text>
        <View style={styles.specGrid}>
          <Spec label="Transmission" value={vehicle.transmission} />
          <Spec label="Passengers" value={`${vehicle.seats} seats`} />
          <Spec label="Luggage" value={`${vehicle.bags} bags`} />
          <Spec label="Security deposit" value={vehicle.securityDeposit > 0 ? formatJmd(vehicle.securityDeposit) : "Confirmed during booking"} />
        </View>
        <Button label="Reserve this vehicle" href={{ pathname: "/(tabs)/book", params: { vehicle: vehicle.id } }} />
        <Button label="Review rental policies" href="/policies" secondary />
      </Card>
    </Screen>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.spec}><Text style={styles.specLabel}>{label}</Text><Text style={styles.specValue}>{value}</Text></View>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  gallery: { gap: 12, paddingHorizontal: 20, paddingVertical: 22 },
  image: { width: 310, height: 230, borderRadius: radii.lg, backgroundColor: colors.surfaceSoft },
  price: { color: colors.tealDark, fontSize: 27, fontWeight: "900" },
  perDay: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  specGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  spec: { width: "48%", flexGrow: 1, backgroundColor: colors.surfaceSoft, borderRadius: radii.md, padding: 14 },
  specLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  specValue: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 5 },
});

import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button, Notice, PageIntro, PhotoCard, Screen } from "@/components/primitives";
import { colors } from "@/constants/theme";
import { formatJmd } from "@/data/catalog";
import { useFleet } from "@/hooks/useFleet";

export default function FleetScreen() {
  const { vehicles, loading, source, error, refresh } = useFleet();

  return (
    <Screen>
      <PageIntro eyebrow="Curated collection" title="Our Complete Fleet" description="Compare rates, passenger space and luggage capacity, then reserve the right vehicle for your trip." />
      <View style={styles.status}>
        {loading ? <ActivityIndicator color={colors.teal} /> : null}
        <Text style={styles.statusText}>{source === "live" ? "Live fleet and rates" : "Offline catalogue"}</Text>
        <Button label="Refresh" onPress={refresh} secondary />
      </View>
      {error ? <Notice error>{error} Showing the bundled catalogue.</Notice> : null}
      {!loading && vehicles.length === 0 ? <Notice>No vehicles are currently available for the selected period.</Notice> : null}
      {vehicles.map((vehicle) => (
        <PhotoCard
          key={vehicle.id}
          image={vehicle.images[0]}
          eyebrow={`${vehicle.category} • ${vehicle.year}`}
          title={vehicle.name}
          body={`${vehicle.transmission}  •  ${vehicle.seats} seats  •  ${vehicle.bags} bags\nFrom ${formatJmd(vehicle.dailyRate)} per day`}
          action={<Button label="View details" href={{ pathname: "/fleet/[id]", params: { id: vehicle.id } }} />}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { marginHorizontal: 20, marginVertical: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  statusText: { flex: 1, color: colors.muted, fontSize: 13, fontWeight: "700" },
});

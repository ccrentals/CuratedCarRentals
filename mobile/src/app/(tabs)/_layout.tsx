import { Tabs } from "expo-router";
import { Text } from "react-native";

import { colors } from "@/constants/theme";

const icons: Record<string, string> = { index: "⌂", fleet: "▰", book: "✓", explore: "☰" };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: "#7C8799",
        tabBarStyle: { height: 68, paddingTop: 7, paddingBottom: 8, borderTopColor: colors.border, backgroundColor: colors.surface },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 21, fontWeight: "800" }}>{icons[route.name] ?? "•"}</Text>,
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="fleet" options={{ title: "Fleet" }} />
      <Tabs.Screen name="book" options={{ title: "Book" }} />
      <Tabs.Screen name="explore" options={{ title: "More" }} />
    </Tabs>
  );
}

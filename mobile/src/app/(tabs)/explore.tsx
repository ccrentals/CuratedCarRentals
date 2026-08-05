import { Link, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PageIntro, Screen } from "@/components/primitives";
import { useAppTheme, type ThemeMode } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

const links: { icon: string; title: string; body: string; href: Href }[] = [
  { icon: "▣", title: "My Bookings", body: "Review saved reservations and continue outstanding payments.", href: "/booking-status" },
  { icon: "✦", title: "Services", body: "Airport pickup, chauffeurs, weddings and corporate rentals.", href: "/services" },
  { icon: "⌖", title: "Tourist Destinations", body: "Plan scenic drives and island adventures.", href: "/destinations" },
  { icon: "☑", title: "Rental Policies", body: "Review IDs, deposits, insurance and reservation terms.", href: "/policies" },
  { icon: "↟", title: "Driving in Jamaica", body: "Practical guidance for safe island travel.", href: "/driving" },
  { icon: "◎", title: "About Us", body: "Meet Curated Car Rentals and learn about our mission.", href: "/about" },
  { icon: "✆", title: "Contact", body: "Call, WhatsApp, email or send a booking question.", href: "/contact" },
];

export default function ExploreScreen() {
  const { colors, isDark, mode, setMode } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const modes: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <Screen>
      <PageIntro eyebrow="Explore" title="More from Curated" description="Everything you need to plan your rental and enjoy Jamaica with confidence." />
      <View style={styles.grid}>
        <View style={styles.appearanceCard}>
          <View style={styles.iconWrap}><Text style={styles.icon}>{isDark ? "☾" : "☀"}</Text></View>
          <View style={styles.content}>
            <Text style={styles.title}>Appearance</Text>
            <Text style={styles.body}>Choose how Curated looks on this device.</Text>
            <View style={styles.modeRow}>
              {modes.map((item) => (
                <Pressable key={item.value} onPress={() => setMode(item.value)} style={[styles.modeButton, mode === item.value && styles.modeButtonActive]} accessibilityRole="radio" accessibilityState={{ checked: mode === item.value }}>
                  <Text style={[styles.modeText, mode === item.value && styles.modeTextActive]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        {links.map((item) => (
          <Link href={item.href} asChild key={item.title}>
            <Pressable style={styles.card} accessibilityRole="button">
              <View style={styles.iconWrap}><Text style={styles.icon}>{item.icon}</Text></View>
              <View style={styles.content}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            </Pressable>
          </Link>
        ))}
        <View style={styles.staffDivider} />
        <Text style={styles.staffLabel}>CURATED TEAM</Text>
        <Link href={"/admin" as Href} asChild>
          <Pressable style={styles.staffCard} accessibilityRole="button">
            <View style={styles.staffIcon}><Text style={styles.staffIconText}>◆</Text></View>
            <View style={styles.content}>
              <View style={styles.titleRow}><Text style={styles.staffTitle}>Staff workspace</Text><Text style={styles.staffChevron}>›</Text></View>
              <Text style={styles.staffBody}>Secure access for authorized Curated team members.</Text>
            </View>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  grid: { paddingHorizontal: 20, paddingTop: 24, gap: 14 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 17 },
  appearanceCard: { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 17 },
  iconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? colors.navySoft : "#FFF2EC" },
  icon: { color: colors.orange, fontSize: 20, fontWeight: "900" },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "800" },
  chevron: { color: colors.teal, fontSize: 27, lineHeight: 25, fontWeight: "500" },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 5 },
  modeRow: { flexDirection: "row", gap: 6, marginTop: 13, padding: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceSoft },
  modeButton: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  modeButtonActive: { backgroundColor: colors.teal },
  modeText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  modeTextActive: { color: colors.white },
  staffDivider: { height: 1, backgroundColor: colors.border, marginTop: 8, marginBottom: 2 },
  staffLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginTop: 5 },
  staffCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.navy, borderRadius: radii.lg, padding: 17 },
  staffIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.navySoft },
  staffIconText: { color: colors.orange, fontSize: 17, fontWeight: "900" },
  staffTitle: { flex: 1, color: colors.white, fontSize: 17, fontWeight: "900" },
  staffChevron: { color: colors.orange, fontSize: 27, lineHeight: 25 },
  staffBody: { color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 18, marginTop: 4 },
});

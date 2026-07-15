import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PageIntro, Screen } from "@/components/primitives";
import { colors, radii } from "@/constants/theme";

const links: { icon: string; title: string; body: string; href: Href }[] = [
  { icon: "▣", title: "My Booking", body: "Check your saved reservation and complete its deposit.", href: "/booking-status" },
  { icon: "✦", title: "Services", body: "Airport pickup, chauffeurs, weddings and corporate rentals.", href: "/services" },
  { icon: "⌖", title: "Tourist Destinations", body: "Plan scenic drives and island adventures.", href: "/destinations" },
  { icon: "☑", title: "Rental Policies", body: "Review IDs, deposits, insurance and reservation terms.", href: "/policies" },
  { icon: "◈", title: "Privacy Policy", body: "See how reservation, payment and device information is handled.", href: "/privacy" },
  { icon: "↟", title: "Driving in Jamaica", body: "Practical guidance for safe island travel.", href: "/driving" },
  { icon: "◎", title: "About Us", body: "Meet Curated Car Rentals and learn about our mission.", href: "/about" },
  { icon: "✆", title: "Contact", body: "Call, WhatsApp, email or send a booking question.", href: "/contact" },
];

export default function ExploreScreen() {
  return (
    <Screen>
      <PageIntro eyebrow="Explore" title="More from Curated" description="Everything you need to plan your rental and enjoy Jamaica with confidence." />
      <View style={styles.grid}>
        {links.map((item) => (
          <Link href={item.href} asChild key={item.title}>
            <Pressable style={styles.card} accessibilityRole="button">
              <Text style={styles.icon}>{item.icon}</Text>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.arrow}>View details →</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: 20, paddingTop: 24, gap: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 20 },
  icon: { color: colors.orange, fontSize: 25, fontWeight: "900" },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 10 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 7 },
  arrow: { color: colors.teal, fontSize: 14, fontWeight: "800", marginTop: 14 },
});

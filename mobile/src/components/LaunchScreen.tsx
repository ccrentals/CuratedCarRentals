import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { colors } from "@/constants/theme";

export function LaunchScreen({ onFinish }: { onFinish: () => void }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [contentOpacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.92));
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 13, stiffness: 115, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 1, duration: 1050, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(180),
      Animated.timing(opacity, { toValue: 0, duration: 280, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(({ finished }) => finished && onFinish());
  }, [contentOpacity, onFinish, opacity, progress, scale]);

  return (
    <Animated.View style={[styles.container, { opacity }]} accessibilityViewIsModal>
      <View style={styles.sun} />
      <View style={styles.glow} />
      <Animated.View style={[styles.identity, { opacity: contentOpacity, transform: [{ scale }] }]}>
        <View style={styles.logoWrap}><BrandLogo light size={108} /></View>
        <Text style={styles.kicker}>JAMAICA, CURATED FOR THE ROAD</Text>
        <Text style={styles.message}>Your island journey is ready.</Text>
      </Animated.View>
      <View style={styles.loadingTrack}>
        <Animated.View style={[styles.loadingBar, { transform: [{ scaleX: progress }] }]} />
      </View>
      <Text style={styles.loadingLabel}>PREPARING YOUR EXPERIENCE</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: colors.navy },
  sun: { position: "absolute", top: -80, right: -110, width: 320, height: 320, borderRadius: 160, backgroundColor: "rgba(245,181,61,0.14)" },
  glow: { position: "absolute", bottom: -150, left: -140, width: 390, height: 390, borderRadius: 195, backgroundColor: "rgba(39,117,95,0.22)" },
  identity: { alignItems: "center", paddingHorizontal: 26 },
  logoWrap: { padding: 18, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  kicker: { color: "#9FE3CB", fontSize: 10, fontWeight: "900", letterSpacing: 2.1, textAlign: "center", marginTop: 26 },
  message: { color: colors.white, fontSize: 20, lineHeight: 27, fontWeight: "800", textAlign: "center", marginTop: 9 },
  loadingTrack: { position: "absolute", bottom: 72, width: 132, height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: "rgba(255,255,255,0.14)" },
  loadingBar: { width: "100%", height: "100%", transformOrigin: "left", backgroundColor: colors.orange },
  loadingLabel: { position: "absolute", bottom: 45, color: "rgba(255,255,255,0.45)", fontSize: 8, fontWeight: "800", letterSpacing: 1.4 },
});

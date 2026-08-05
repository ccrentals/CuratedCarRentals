import { Image, type ImageProps } from "expo-image";
import { Link, type Href } from "expo-router";
import { useMemo, type PropsWithChildren, type ReactNode, type RefObject } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/components/ThemeProvider";
import { radii, shadow, type AppColors } from "@/constants/theme";

function useStyles() {
  const { colors } = useAppTheme();
  return useMemo(() => makeStyles(colors), [colors]);
}

export function Screen({ children, dark = false, scrollRef }: PropsWithChildren<{ dark?: boolean; scrollRef?: RefObject<ScrollView | null> }>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={[styles.safe, dark && styles.safeDark]} edges={["top"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: 92 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function PageIntro({ eyebrow, title, description }: { eyebrow?: string; title: string; description: string }) {
  const styles = useStyles();
  return (
    <View style={styles.intro}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

export function SectionTitle({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionTitle}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.heading}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PhotoCard({ image, eyebrow, title, body, action }: { image: ImageProps["source"]; eyebrow?: string; title: string; body: string; action?: ReactNode }) {
  const styles = useStyles();
  return (
    <Card style={styles.photoCard}>
      <Image source={image} style={styles.photo} contentFit="cover" transition={180} accessibilityLabel={title} />
      <View style={styles.photoBody}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
        {action}
      </View>
    </Card>
  );
}

export function Button({ label, href, onPress, secondary = false, disabled = false }: { label: string; href?: Href; onPress?: () => void; secondary?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  const content = <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>;
  const buttonStyle = StyleSheet.flatten([styles.button, secondary && styles.buttonSecondary, disabled && styles.buttonDisabled]);
  if (href) {
    return <Link href={href} asChild><Pressable style={buttonStyle} accessibilityRole="button">{content}</Pressable></Link>;
  }
  return <Pressable style={buttonStyle} onPress={onPress} disabled={disabled} accessibilityRole="button">{content}</Pressable>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.field} {...props} />
    </View>
  );
}

export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  const styles = useStyles();
  return <Text style={[styles.notice, error && styles.noticeError]}>{children}</Text>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfaceSoft },
  safeDark: { backgroundColor: colors.navy },
  scroll: { flexGrow: 1, paddingBottom: 36 },
  intro: { backgroundColor: colors.navy, paddingHorizontal: 22, paddingTop: 34, paddingBottom: 38 },
  eyebrow: { color: colors.orange, fontSize: 12, fontWeight: "800", letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10 },
  title: { color: colors.white, fontSize: 36, lineHeight: 41, fontWeight: "800", letterSpacing: -0.8 },
  heading: { color: colors.text, fontSize: 27, lineHeight: 33, fontWeight: "800", letterSpacing: -0.4 },
  description: { color: colors.muted, fontSize: 16, lineHeight: 25, marginTop: 12 },
  sectionTitle: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 18 },
  card: { marginHorizontal: 20, marginBottom: 18, padding: 20, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  photoCard: { overflow: "hidden", padding: 0 },
  photo: { width: "100%", height: 210, backgroundColor: colors.surfaceSoft },
  photoBody: { padding: 20 },
  cardTitle: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: "800" },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 8 },
  button: { minHeight: 50, marginTop: 18, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.teal },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "800" },
  buttonTextSecondary: { color: colors.tealDark },
  fieldWrap: { marginTop: 15 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 7 },
  field: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  notice: { marginTop: 16, borderRadius: radii.md, backgroundColor: colors.cream, color: colors.success, borderWidth: 1, borderColor: colors.border, padding: 14, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  noticeError: { backgroundColor: colors.surface, color: colors.danger, borderColor: colors.danger },
});

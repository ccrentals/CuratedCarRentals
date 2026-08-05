import { MaterialIcons } from "@expo/vector-icons";
import { Redirect, router, type Href } from "expo-router";
import { useMemo, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { BrandLogo } from "@/components/BrandLogo";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, shadow, type AppColors } from "@/constants/theme";

type AdminScreenProps = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  subtitle?: string;
  back?: boolean;
  action?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  onBackRequest?: () => void;
}>;

export function AdminScreen({
  title,
  eyebrow,
  subtitle,
  back = false,
  action,
  refreshing = false,
  onRefresh,
  onBackRequest,
  children,
}: AdminScreenProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {back ? (
            <Pressable onPress={onBackRequest ?? (() => router.back())} style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel="Go back">
              <MaterialIcons name="arrow-back" size={22} color={colors.white} />
            </Pressable>
          ) : <BrandLogo compact light size={38} />}
          <View style={styles.headerSpacer} />
          {action}
        </View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} colors={[colors.orange]} progressBackgroundColor={colors.surface} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function AdminGate({ children }: PropsWithChildren) {
  const { status, error, refresh, signOut } = useAdminAuth();
  if (status === "signed_out") return <Redirect href={"/admin/sign-in" as Href} />;
  if (status === "ready") return children;

  if (status === "loading" || status === "exchanging") {
    return <AdminState icon="shield" title="Securing your workspace" body="Verifying your staff account and access level…" loading />;
  }

  if (status === "forbidden") {
    return (
      <AdminState
        icon="lock"
        title="Staff access unavailable"
        body={error || "This account is not enabled for the Curated staff workspace."}
        primaryLabel="Try another account"
        onPrimary={() => void signOut()}
      />
    );
  }

  return (
    <AdminState
      icon={status === "config_missing" ? "settings" : "cloud-off"}
      title={status === "config_missing" ? "Admin sign-in needs setup" : "Couldn’t open the workspace"}
      body={error || "Check your connection and try again."}
      primaryLabel={status === "config_missing" ? undefined : "Try again"}
      onPrimary={status === "config_missing" ? undefined : () => void refresh()}
      secondaryLabel="Back to customer app"
      onSecondary={() => router.replace("/(tabs)" as Href)}
    />
  );
}

function AdminState({
  icon,
  title,
  body,
  loading = false,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  body: string;
  loading?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.stateSafe}>
      <View style={styles.stateBrand}><BrandLogo light size={48} /></View>
      <View style={styles.stateCard}>
        <View style={styles.stateIcon}>
          {loading ? <ActivityIndicator color={colors.orange} size="large" /> : <MaterialIcons name={icon} size={30} color={colors.orange} />}
        </View>
        <Text style={styles.stateTitle}>{title}</Text>
        <Text style={styles.stateBody}>{body}</Text>
        {primaryLabel && onPrimary ? <AdminButton label={primaryLabel} onPress={onPrimary} /> : null}
        {secondaryLabel && onSecondary ? <AdminButton label={secondaryLabel} onPress={onSecondary} secondary /> : null}
      </View>
    </SafeAreaView>
  );
}

export function AdminButton({ label, onPress, secondary = false, disabled = false, icon }: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, (pressed || disabled) && styles.buttonPressed]} accessibilityRole="button">
      {icon ? <MaterialIcons name={icon} size={19} color={secondary ? colors.tealDark : colors.white} /> : null}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

export function AdminCard({ children, style }: PropsWithChildren<{ style?: object }>) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={[styles.card, style]}>{children}</View>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfaceSoft },
  header: { backgroundColor: colors.navy, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  headerTop: { minHeight: 44, flexDirection: "row", alignItems: "center", marginBottom: 24 },
  headerSpacer: { flex: 1 },
  headerIconButton: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  eyebrow: { color: colors.orange, fontSize: 11, fontWeight: "900", letterSpacing: 1.7, textTransform: "uppercase", marginBottom: 8 },
  headerTitle: { color: colors.white, fontSize: 31, lineHeight: 37, fontWeight: "900", letterSpacing: -0.7 },
  headerSubtitle: { color: "rgba(255,255,255,0.68)", fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 520 },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 18, gap: 14 },
  card: { padding: 18, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  stateSafe: { flex: 1, backgroundColor: colors.navy, paddingHorizontal: 22, justifyContent: "center" },
  stateBrand: { position: "absolute", top: 60, left: 22 },
  stateCard: { backgroundColor: colors.surface, borderRadius: 28, padding: 24, alignItems: "center" },
  stateIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  stateTitle: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  stateBody: { color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: "center", marginTop: 10, marginBottom: 4 },
  button: { minHeight: 52, width: "100%", marginTop: 16, borderRadius: radii.pill, backgroundColor: colors.orange, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.teal },
  buttonPressed: { opacity: 0.62 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "900" },
  buttonTextSecondary: { color: colors.tealDark },
});

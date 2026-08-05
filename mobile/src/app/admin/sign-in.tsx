import { MaterialIcons } from "@expo/vector-icons";
import { Redirect, router, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { adminAuthUnavailableReason, isAdminAuthConfigured, isExpoGoRuntime, useAdminAuth } from "@/admin/AdminAuthProvider";
import { AdminButton } from "@/admin/AdminShell";
import { BrandLogo } from "@/components/BrandLogo";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, shadow, type AppColors } from "@/constants/theme";

type MfaMode = "totp" | "email" | "phone" | "backup";

export default function AdminSignInScreen() {
  const { status } = useAdminAuth();
  if (status === "ready") return <Redirect href={"/admin" as Href} />;
  if (!isAdminAuthConfigured) return <UnconfiguredSignIn />;
  return <ConfiguredSignIn />;
}

function ConfiguredSignIn() {
  // This screen only renders when the Clerk native runtime is available.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSignIn } = require("@clerk/expo") as typeof import("@clerk/expo");
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn, fetchStatus } = useSignIn();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMode, setMfaMode] = useState<MfaMode>("totp");
  const [mfaSent, setMfaSent] = useState(false);
  const [error, setError] = useState("");
  const isBusy = fetchStatus === "fetching";
  const needsMfa = signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust";

  const finishIfComplete = async () => {
    if (signIn.status !== "complete") return false;
    const result = await signIn.finalize();
    if (result.error) throw result.error;
    router.replace("/admin" as Href);
    return true;
  };

  const signInWithPassword = async () => {
    if (!identifier.trim() || !password) return setError("Enter your staff email or username and password.");
    setError("");
    try {
      const result = await signIn.password({ identifier: identifier.trim(), password });
      if (result.error) throw result.error;
      if (await finishIfComplete()) return;
      if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") return;
      setError("Your account requires an additional sign-in step that is not currently available.");
    } catch (signInError) {
      setError(readClerkError(signInError));
    }
  };

  const chooseMfa = async (mode: MfaMode) => {
    setMfaMode(mode);
    setMfaCode("");
    setError("");
    setMfaSent(false);
    try {
      if (mode === "email") {
        const result = await signIn.mfa.sendEmailCode();
        if (result.error) throw result.error;
        setMfaSent(true);
      } else if (mode === "phone") {
        const result = await signIn.mfa.sendPhoneCode();
        if (result.error) throw result.error;
        setMfaSent(true);
      }
    } catch (mfaError) {
      setError(readClerkError(mfaError));
    }
  };

  const verifyMfa = async () => {
    if (!mfaCode.trim()) return setError("Enter your verification code.");
    setError("");
    try {
      const code = mfaCode.trim();
      const result = mfaMode === "email"
        ? await signIn.mfa.verifyEmailCode({ code })
        : mfaMode === "phone"
          ? await signIn.mfa.verifyPhoneCode({ code })
          : mfaMode === "backup"
            ? await signIn.mfa.verifyBackupCode({ code })
            : await signIn.mfa.verifyTOTP({ code });
      if (result.error) throw result.error;
      if (!(await finishIfComplete())) setError("Verification is not complete yet. Try another available method.");
    } catch (mfaError) {
      setError(readClerkError(mfaError));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <BrandLogo light size={48} />
            <Pressable onPress={() => router.replace("/(tabs)")} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close staff sign in">
              <MaterialIcons name="close" size={22} color={colors.white} />
            </Pressable>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>CURATED STAFF</Text>
            <Text style={styles.heroTitle}>Run the day from anywhere.</Text>
            <Text style={styles.heroBody}>Secure access to reservations, customers, fleet operations, messages, and business performance.</Text>
          </View>
          <View style={styles.formCard}>
            <View style={styles.securityRow}>
              <View style={styles.securityIcon}><MaterialIcons name="verified-user" size={22} color={colors.tealDark} /></View>
              <View style={styles.securityCopy}><Text style={styles.formTitle}>{needsMfa ? "Verify it’s you" : "Staff sign in"}</Text><Text style={styles.formSubtitle}>{needsMfa ? "Complete your configured second factor." : "Use the same secure account as the web admin."}</Text></View>
            </View>

            {!needsMfa ? (
              <>
                <AuthField label="Email or username" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoComplete="username" keyboardType="email-address" editable={!isBusy} />
                <AuthField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!isBusy} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AdminButton label={isBusy ? "Signing in…" : "Continue securely"} onPress={() => void signInWithPassword()} disabled={isBusy} icon="lock" />
              </>
            ) : (
              <>
                <View style={styles.mfaModes}>
                  {(["totp", "email", "phone", "backup"] as const).map((mode) => (
                    <Pressable key={mode} onPress={() => void chooseMfa(mode)} style={[styles.mfaChip, mfaMode === mode && styles.mfaChipActive]}>
                      <Text style={[styles.mfaChipText, mfaMode === mode && styles.mfaChipTextActive]}>{mode === "totp" ? "Authenticator" : mode === "backup" ? "Backup" : mode === "email" ? "Email" : "SMS"}</Text>
                    </Pressable>
                  ))}
                </View>
                <AuthField label={mfaMode === "backup" ? "Backup code" : "Verification code"} value={mfaCode} onChangeText={setMfaCode} keyboardType={mfaMode === "backup" ? "default" : "number-pad"} autoComplete="one-time-code" editable={!isBusy} />
                {mfaSent ? <Text style={styles.sent}>A fresh code was sent to your configured {mfaMode === "phone" ? "phone" : "email"}.</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AdminButton label={isBusy ? "Verifying…" : "Verify and continue"} onPress={() => void verifyMfa()} disabled={isBusy} icon="verified" />
                <AdminButton label="Start over" onPress={() => void signIn.reset()} disabled={isBusy} secondary />
              </>
            )}
            <View style={styles.trustRow}><MaterialIcons name="security" size={16} color={colors.muted} /><Text style={styles.trustText}>Your password and verification codes are handled by Clerk and are never stored by Curated.</Text></View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthField({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.field} placeholderTextColor={colors.muted} /></View>;
}

function UnconfiguredSignIn() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <SafeAreaView style={styles.safe}><View style={styles.unconfigured}><BrandLogo light /><Text style={styles.heroTitle}>{isExpoGoRuntime ? "Open staff tools in the installed app." : "Staff sign-in needs configuration."}</Text><Text style={styles.heroBody}>{adminAuthUnavailableReason}</Text><AdminButton label="Back to customer app" onPress={() => router.replace("/(tabs)")} secondary /></View></SafeAreaView>;
}

function readClerkError(error: unknown) {
  if (error && typeof error === "object") {
    if ("longMessage" in error && typeof error.longMessage === "string") return error.longMessage;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "Sign-in could not be completed. Check your details and try again.";
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.navy },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeButton: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  heroCopy: { paddingTop: 38, paddingBottom: 26 },
  eyebrow: { color: colors.orange, fontSize: 11, fontWeight: "900", letterSpacing: 1.8, marginBottom: 10 },
  heroTitle: { color: colors.white, fontSize: 34, lineHeight: 40, fontWeight: "900", letterSpacing: -0.8 },
  heroBody: { color: "rgba(255,255,255,0.68)", fontSize: 15, lineHeight: 23, marginTop: 12 },
  formCard: { backgroundColor: colors.surface, borderRadius: 28, padding: 22, ...shadow },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  securityIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  securityCopy: { flex: 1 },
  formTitle: { color: colors.text, fontSize: 21, fontWeight: "900" },
  formSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  fieldWrap: { marginTop: 17 },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  field: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.surfaceSoft, fontSize: 16 },
  error: { color: colors.danger, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.danger, borderRadius: radii.md, padding: 12, marginTop: 14, fontSize: 13, lineHeight: 19 },
  sent: { color: colors.success, fontSize: 12, lineHeight: 18, marginTop: 10, fontWeight: "700" },
  mfaModes: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 18 },
  mfaChip: { paddingHorizontal: 12, minHeight: 36, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border },
  mfaChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  mfaChipText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  mfaChipTextActive: { color: colors.white },
  trustRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 20 },
  trustText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  unconfigured: { flex: 1, padding: 24, justifyContent: "center", gap: 18 },
});

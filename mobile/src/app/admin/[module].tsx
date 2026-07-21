import { MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ADMIN_MODULES, hasCapability } from "@/admin/capabilities";
import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function AdminModuleScreen() {
  return <AdminGate><ProtectedModule /></AdminGate>;
}

function ProtectedModule() {
  const params = useLocalSearchParams<{ module?: string }>();
  const { user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const module = ADMIN_MODULES.find((item) => item.key === params.module);

  if (!module || !user || !hasCapability(user.role, module.capability)) {
    return (
      <AdminScreen back title="Workspace unavailable" eyebrow="STAFF WORKSPACE" subtitle="This module is not included in your current staff role.">
        <AdminCard><Text style={styles.title}>Access is role-protected</Text><Text style={styles.body}>If you believe you need this workspace, ask an administrator to review your staff role.</Text><AdminButton label="Return to dashboard" onPress={() => router.replace("/admin" as Href)} secondary /></AdminCard>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen back title={module.title} eyebrow="STAFF WORKSPACE" subtitle={module.description}>
      <AdminCard style={styles.card}>
        <View style={styles.icon}><MaterialIcons name={module.icon as React.ComponentProps<typeof MaterialIcons>["name"]} size={30} color={colors.tealDark} /></View>
        <Text style={styles.title}>{module.title} workspace</Text>
        <Text style={styles.body}>The secure native foundation is active. This operational module is being connected and reviewed feature by feature.</Text>
        <View style={styles.notice}><MaterialIcons name="verified-user" size={18} color={colors.success} /><Text style={styles.noticeText}>Your role was verified by the server before this workspace opened.</Text></View>
        <AdminButton label="Return to dashboard" onPress={() => router.replace("/admin" as Href)} secondary />
      </AdminCard>
    </AdminScreen>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  card: { alignItems: "center", paddingVertical: 28 },
  icon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 9 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginTop: 18, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  noticeText: { flex: 1, color: colors.success, fontSize: 12, lineHeight: 18, fontWeight: "700" },
});

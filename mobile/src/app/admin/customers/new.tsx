import { MaterialIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import { createAdminCustomer } from "@/admin/api";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

export default function NewAdminCustomerScreen() { return <AdminGate><NewCustomer /></AdminGate>; }

function NewCustomer() {
  const { request } = useAdminAuth(); const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);
  const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [address, setAddress] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError("First name and last name are required."); return; }
    setBusy(true); setError("");
    try { const customer = await createAdminCustomer(request, { firstName: firstName.trim(), lastName: lastName.trim(), fullName: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), phone: phone.trim(), address: address.trim(), notes: notes.trim() }); router.replace(`/admin/customers/${customer.id}` as Href); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to create customer."); }
    finally { setBusy(false); }
  };
  return <AdminScreen back eyebrow="NEW RELATIONSHIP" title="Add customer" subtitle="Start with reliable contact details. Identity documents can be managed later in the protected customer record.">
    {error ? <View style={styles.error}><MaterialIcons name="error-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <AdminCard><Text style={styles.sectionTitle}>Customer details</Text><Field label="First name *" value={firstName} onChangeText={setFirstName} autoCapitalize="words" /><Field label="Last name *" value={lastName} onChangeText={setLastName} autoCapitalize="words" /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" /><Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Address" value={address} onChangeText={setAddress} multiline /><Field label="Internal notes" value={notes} onChangeText={setNotes} multiline /><AdminButton label={busy ? "Creating customer…" : "Create customer"} onPress={() => void save()} disabled={busy} icon="person-add" /></AdminCard>
  </AdminScreen>;
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) { const { colors } = useAppTheme(); const styles = useMemo(() => makeStyles(colors), [colors]); return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} placeholderTextColor={colors.muted} style={[styles.input, props.multiline && styles.multiline]} /></View>; }
const makeStyles = (colors: AppColors) => StyleSheet.create({ sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginBottom: 5 }, field: { marginTop: 14 }, label: { color: colors.muted, fontSize: 10, fontWeight: "900", marginBottom: 7 }, input: { minHeight: 50, paddingHorizontal: 14, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14 }, multiline: { minHeight: 88, paddingTop: 13, textAlignVertical: "top" }, error: { flexDirection: "row", alignItems: "center", gap: 8, padding: 13, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger }, errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 } });

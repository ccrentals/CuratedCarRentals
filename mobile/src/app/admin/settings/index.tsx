import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAdminAuth } from "@/admin/AdminAuthProvider";
import {
  AdminSettingsError,
  fetchAdminSettings,
  saveAdminSettings,
  type AdminSettings,
  type AdminSettingsFieldErrors,
  type AdminSettingsOwnershipOption,
  type AdminSettingsPayload,
} from "@/admin/api";
import { hasCapability } from "@/admin/capabilities";
import { AdminButton, AdminCard, AdminGate, AdminScreen } from "@/admin/AdminShell";
import { formFromSettings, prepareAdminSettings, settingsSnapshot, type SettingsForm } from "@/admin/settingsModel";
import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

type SettingsTab = "booking" | "notifications" | "maintenance" | "fleet";

const TABS: { key: SettingsTab; label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }[] = [
  { key: "booking", label: "Booking", icon: "event-available" },
  { key: "notifications", label: "Alerts", icon: "notifications-active" },
  { key: "maintenance", label: "Maintenance", icon: "build" },
  { key: "fleet", label: "Fleet", icon: "directions-car" },
];

export default function AdminSettingsScreen() {
  return <AdminGate><SettingsWorkspace /></AdminGate>;
}

function SettingsWorkspace() {
  const { request, user } = useAdminAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allowed = Boolean(user && hasCapability(user.role, "settings.read"));
  const canWrite = Boolean(user && hasCapability(user.role, "settings.write"));
  const [payload, setPayload] = useState<AdminSettingsPayload | null>(null);
  const [draft, setDraft] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [tab, setTab] = useState<SettingsTab>("booking");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AdminSettingsFieldErrors>({});

  const hydrate = useCallback((next: AdminSettingsPayload) => {
    const nextForm = formFromSettings(next.settings);
    setPayload(next);
    setDraft(next.settings);
    setForm(nextForm);
    setSavedSnapshot(settingsSnapshot(next.settings, nextForm));
    setFieldErrors({});
  }, []);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      hydrate(await fetchAdminSettings(request));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load platform settings.");
    } finally {
      setLoading(false);
    }
  }, [allowed, hydrate, request]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const isDirty = Boolean(draft && form && settingsSnapshot(draft, form) !== savedSnapshot);

  const requestBack = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Discard unsaved settings?",
      "Your changes have not been saved and will be lost.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ],
    );
  }, [isDirty]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestBack();
      return true;
    });
    return () => subscription.remove();
  }, [requestBack]);

  const refresh = () => {
    if (!isDirty) {
      void load();
      return;
    }
    Alert.alert("Reload settings?", "This will discard your unsaved changes and load the latest server values.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Reload", style: "destructive", onPress: () => void load() },
    ]);
  };

  const updateSetting = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSuccess("");
    setError("");
  };

  const updateForm = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
    setSuccess("");
    setError("");
  };

  const save = () => {
    if (!draft || !form || !payload || !canWrite) return;
    const prepared = prepareAdminSettings(draft, form);
    if (!prepared.ok) {
      setFieldErrors(prepared.errors);
      setError("Review the highlighted settings before saving.");
      return;
    }
    Alert.alert(
      "Save live platform settings?",
      "These operational rules apply across the website and staff app immediately.",
      [
        { text: "Review again", style: "cancel" },
        { text: "Save settings", onPress: () => void persist(prepared.settings) },
      ],
    );
  };

  const persist = async (settings: AdminSettings) => {
    if (!payload) return;
    setSaving(true);
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const next = await saveAdminSettings(request, settings, payload.updatedAt);
      hydrate(next);
      setSuccess("Settings saved successfully.");
    } catch (saveError) {
      if (saveError instanceof AdminSettingsError && saveError.status === 422) {
        setFieldErrors(saveError.payload.fieldErrors ?? {});
        setError(saveError.message);
      } else if (saveError instanceof AdminSettingsError && saveError.status === 409) {
        try {
          hydrate(await fetchAdminSettings(request));
          setError("Settings changed elsewhere. The latest values are loaded; review and save again.");
        } catch {
          setError(saveError.message);
        }
      } else {
        setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return <AdminScreen back title="Workspace unavailable" subtitle="Platform settings require administrator access." />;
  }

  return (
    <AdminScreen
      back
      onBackRequest={requestBack}
      eyebrow="PLATFORM CONTROL"
      title="Settings"
      subtitle="Manage booking rules, operational alerts, maintenance thresholds, and fleet defaults."
      refreshing={loading && Boolean(payload)}
      onRefresh={refresh}
    >
      {error ? <StatusNotice tone="error" icon="error-outline" text={error} /> : null}
      {success ? <StatusNotice tone="success" icon="check-circle" text={success} /> : null}
      {isDirty ? <StatusNotice tone="warning" icon="edit-note" text="Unsaved changes — review and save before leaving." /> : null}

      {!payload || !draft || !form ? (
        <AdminCard>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.orange} /><Text style={styles.loadingText}>Loading secure settings…</Text></View> : <AdminButton label="Try again" onPress={() => void load()} />}
        </AdminCard>
      ) : (
        <>
          <AdminCard style={styles.metaCard}>
            <View style={styles.metaTop}>
              <View style={styles.metaIcon}><MaterialIcons name="verified-user" size={22} color={colors.tealDark} /></View>
              <View style={styles.metaCopy}>
                <Text style={styles.metaTitle}>Live operational configuration</Text>
                <Text style={styles.metaText}>{payload.updatedAt ? `Updated ${formatDate(payload.updatedAt)}` : "No saved update timestamp"}{payload.updatedByEmail ? ` · ${payload.updatedByEmail}` : ""}</Text>
              </View>
              <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
            </View>
          </AdminCard>

          <View style={styles.tabs}>
            {TABS.map((item) => (
              <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
                <MaterialIcons name={item.icon} size={17} color={tab === item.key ? colors.white : colors.muted} />
                <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "booking" ? <BookingSettings draft={draft} form={form} errors={fieldErrors} updateSetting={updateSetting} updateForm={updateForm} /> : null}
          {tab === "notifications" ? <NotificationSettings draft={draft} form={form} payload={payload} actorRole={user?.role ?? "ADMIN"} errors={fieldErrors} updateSetting={updateSetting} updateForm={updateForm} /> : null}
          {tab === "maintenance" ? <MaintenanceSettings draft={draft} form={form} errors={fieldErrors} updateSetting={updateSetting} updateForm={updateForm} /> : null}
          {tab === "fleet" ? <FleetSettings draft={draft} form={form} errors={fieldErrors} updateForm={updateForm} /> : null}

          <AdminCard style={styles.saveCard}>
            <View style={styles.saveHeader}><MaterialIcons name={isDirty ? "edit" : "check-circle"} size={21} color={isDirty ? colors.orange : colors.success} /><View style={styles.saveCopy}><Text style={styles.saveTitle}>{isDirty ? "Changes ready for review" : "Settings are up to date"}</Text><Text style={styles.saveText}>{isDirty ? "Saving updates the shared live configuration immediately." : "No unsaved changes on this device."}</Text></View></View>
            <AdminButton label={saving ? "Saving settings…" : "Save settings"} onPress={save} disabled={!isDirty || saving || !canWrite} icon="save" />
            {isDirty ? <AdminButton label="Discard changes" onPress={() => hydrate(payload)} disabled={saving} secondary /> : null}
          </AdminCard>
        </>
      )}
    </AdminScreen>
  );
}

function BookingSettings({ draft, form, errors, updateSetting, updateForm }: SectionProps) {
  const { colors } = useAppTheme();
  return <>
    <SectionIntro icon="event-available" title="Booking controls" body="Rules that shape calendar density, customer rentals, and staff payment workflows." />
    <AdminCard>
      <ChoiceField label="Calendar day-view limit" body="Bookings shown before staff choose Show more." value={String(draft.dayViewBookingLimit)} options={["3", "5", "10", "15", "20", "all"]} labels={{ all: "All" }} onChange={(value) => updateSetting("dayViewBookingLimit", value === "all" ? "all" : Number(value))} />
      <InputField label="Minimum rental days" body="Default customer booking minimum, from 1 to 30 days." value={form.minimumRentalDays} onChangeText={(value) => updateForm("minimumRentalDays", value)} keyboardType="number-pad" error={errors.bookingMinimumRentalDays} />
    </AdminCard>
    <AdminCard>
      <ToggleRow title="Blockouts supersede bookings" body="Allows blockouts to begin booking-cancellation workflows. Use only for deliberate operational closures." value={draft.blockoutSupersedesBookings} onValueChange={(value) => updateSetting("blockoutSupersedesBookings", value)} warning />
      <ToggleRow title="Require payment-restore reason" body="Staff must explain why a deleted manual payment is restored." value={draft.requireRestoreReason} onValueChange={(value) => updateSetting("requireRestoreReason", value)} />
    </AdminCard>
    <AdminCard><ReadOnlyRow label="Primary admin sign-in" value={draft.authLoginMethod === "clerk" ? "Clerk (secure default)" : "Legacy fallback"} /><Text style={[sharedStyles.readOnlyNote, { color: colors.muted }]}>This deployment-sensitive control is read-only in the mobile app.</Text></AdminCard>
  </>;
}

function NotificationSettings({ draft, form, payload, actorRole, errors, updateSetting, updateForm }: SectionProps & { payload: AdminSettingsPayload; actorRole: string }) {
  const { colors } = useAppTheme();
  return <>
    <SectionIntro icon="notifications-active" title="Customer & operations alerts" body="Control reminder delivery and make sure business notifications reach accountable staff." />
    <AdminCard>
      <ToggleRow title="Pickup-day reminder" body="Send the customer’s automated pickup reminder." value={draft.sendPickupReminder} onValueChange={(value) => updateSetting("sendPickupReminder", value)} />
      <ToggleRow title="Dropoff-day reminder" body="Send the customer’s automated return reminder." value={draft.sendDropoffReminder} onValueChange={(value) => updateSetting("sendDropoffReminder", value)} />
      <ToggleRow title="Late-dropoff alert" body="Alert operations when the expected return is missed." value={draft.sendLateDropoffAlert} onValueChange={(value) => updateSetting("sendLateDropoffAlert", value)} />
      <ToggleRow title="Vehicle inspection warnings" body="Email operational recipients about inspection issues. At least one valid recipient is required." value={draft.sendVehicleInspectionWarningEmails} onValueChange={(value) => updateSetting("sendVehicleInspectionWarningEmails", value)} warning={payload.operationalRouting.effectiveRecipients.length === 0} />
      {errors.sendVehicleInspectionWarningEmails ? <FieldError message={errors.sendVehicleInspectionWarningEmails} /> : null}
    </AdminCard>
    <AdminCard>
      <InputField label="Contact-form recipients" body="Comma-separated addresses that receive website enquiries." value={form.contactEmails} onChangeText={(value) => updateForm("contactEmails", value)} autoCapitalize="none" keyboardType="email-address" error={errors.contactNotificationEmails} multiline />
      <InputField label="Duplicate-alert cooldown (minutes)" body="Whole number from 1 to 120." value={form.contactCooldown} onChangeText={(value) => updateForm("contactCooldown", value)} keyboardType="number-pad" error={errors.contactNotifyCooldownMinutes} />
      <InputField label="Default operational email" body="Primary configured fallback address." value={form.defaultOperationalEmail} onChangeText={(value) => updateForm("defaultOperationalEmail", value)} autoCapitalize="none" keyboardType="email-address" error={errors.defaultOperationalNotificationEmail} />
      <InputField label="Additional operational emails" body="One address per line, up to 25." value={form.additionalOperationalEmails} onChangeText={(value) => updateForm("additionalOperationalEmails", value)} autoCapitalize="none" keyboardType="email-address" error={errors.additionalOperationalNotificationEmails} multiline />
    </AdminCard>
    <OwnerSelector label="Primary admin owner" value={draft.primaryAdminUserId} currentLabel={payload.ownership.primaryAdmin.label} message={payload.ownership.primaryAdmin.message} options={payload.ownership.primaryAdminOptions} onSelect={(value) => updateSetting("primaryAdminUserId", value)} error={errors.primaryAdminUserId} />
    <OwnerSelector label="Primary developer owner" value={draft.primaryDeveloperUserId} currentLabel={payload.ownership.primaryDeveloper.label} message={actorRole === "DEVELOPER" ? payload.ownership.primaryDeveloper.message : "Only a developer can change this owner."} options={payload.ownership.primaryDeveloperOptions} onSelect={(value) => updateSetting("primaryDeveloperUserId", value)} error={errors.primaryDeveloperUserId} disabled={actorRole !== "DEVELOPER"} />
    <AdminCard>
      <Text style={[sharedStyles.cardTitle, { color: colors.text }]}>Effective routing</Text>
      <Text style={[sharedStyles.cardBody, { color: colors.muted }]}>{payload.operationalRouting.effectiveRecipients.length ? payload.operationalRouting.effectiveRecipients.join("\n") : "No valid operational recipients resolve."}</Text>
      {payload.operationalRouting.usesFallback ? <FieldError message="Fallback environment recipients are currently in use." /> : null}
      {payload.operationalRouting.warnings.map((warning) => <FieldError key={warning} message={warning} />)}
    </AdminCard>
  </>;
}

function MaintenanceSettings({ draft, form, errors, updateSetting, updateForm }: SectionProps) {
  return <>
    <SectionIntro icon="build" title="Maintenance readiness" body="Set the thresholds used to surface due and due-soon fleet work." />
    <AdminCard>
      <ToggleRow title="Enable maintenance reminders" body="Creates due-soon reminder records from the maintenance schedule." value={draft.maintenanceRemindersEnabled} onValueChange={(value) => updateSetting("maintenanceRemindersEnabled", value)} />
      <InputField label="Reminder lead days" body="How far ahead reminders are generated (1–90)." value={form.maintenanceLeadDays} onChangeText={(value) => updateForm("maintenanceLeadDays", value)} keyboardType="number-pad" error={errors.maintenanceReminderLeadDays} />
      <InputField label="Due-soon window (days)" body="Calendar threshold from 1 to 180 days." value={form.maintenanceDueSoonDays} onChangeText={(value) => updateForm("maintenanceDueSoonDays", value)} keyboardType="number-pad" error={errors.maintenanceDueSoonDays} />
      <InputField label="Due-soon distance (km)" body="Odometer threshold from 0 to 25,000 km." value={form.maintenanceDueSoonKm} onChangeText={(value) => updateForm("maintenanceDueSoonKm", value)} keyboardType="number-pad" error={errors.maintenanceDueSoonKm} />
    </AdminCard>
    <AdminCard>
      <InputField label="Maintenance categories" body="One category per line. Values are normalized by the server." value={form.maintenanceCategories} onChangeText={(value) => updateForm("maintenanceCategories", value)} autoCapitalize="characters" error={errors.maintenanceCategories} multiline />
      <InputField label="Priority options" body="One priority per line." value={form.maintenancePriorities} onChangeText={(value) => updateForm("maintenancePriorities", value)} autoCapitalize="characters" error={errors.maintenancePriorities} multiline />
    </AdminCard>
  </>;
}

function FleetSettings({ draft, form, errors, updateForm }: Pick<SectionProps, "draft" | "form" | "errors" | "updateForm">) {
  const { colors } = useAppTheme();
  return <>
    <SectionIntro icon="directions-car" title="Fleet defaults" body="Shared document and depreciation defaults for vehicle administration." />
    <AdminCard>
      <InputField label="Document folders" body="One folder per line. Existing checklist templates are preserved." value={form.documentFolders} onChangeText={(value) => updateForm("documentFolders", value)} error={errors.vehicleDocumentFolders} multiline />
      <InputField label="Document types" body="One vehicle-document type per line." value={form.documentTypes} onChangeText={(value) => updateForm("documentTypes", value)} error={errors.vehicleDocumentTypeOptions} multiline />
    </AdminCard>
    <AdminCard>
      <ReadOnlyRow label="Depreciation method" value={draft.depreciationDefaultMethod.replaceAll("_", " ")} />
      <InputField label="Useful life (months)" body="Default from 1 to 240 months." value={form.depreciationUsefulLife} onChangeText={(value) => updateForm("depreciationUsefulLife", value)} keyboardType="number-pad" error={errors.depreciationDefaultUsefulLifeMonths} />
      <InputField label="Residual value (%)" body="Default from 0 to 95 percent." value={form.depreciationResidual} onChangeText={(value) => updateForm("depreciationResidual", value)} keyboardType="number-pad" error={errors.depreciationDefaultResidualPercent} />
    </AdminCard>
    <AdminCard><Text style={[sharedStyles.cardTitle, { color: colors.text }]}>Per-vehicle deposits</Text><Text style={[sharedStyles.cardBody, { color: colors.muted }]}>{Object.keys(draft.bookingVehicleSecurityDeposits.vehicleDepositsJmd).length} configured vehicle overrides. Edit individual deposits from the vehicle workspace to reduce bulk-setting mistakes.</Text></AdminCard>
  </>;
}

type SectionProps = {
  draft: AdminSettings;
  form: SettingsForm;
  errors: AdminSettingsFieldErrors;
  updateSetting: <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => void;
  updateForm: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void;
};

function SectionIntro({ icon, title, body }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; body: string }) {
  const { colors } = useAppTheme();
  return <View style={sharedStyles.sectionIntro}><View style={[sharedStyles.sectionIcon, { backgroundColor: colors.cream }]}><MaterialIcons name={icon} size={22} color={colors.tealDark} /></View><View style={sharedStyles.sectionCopy}><Text style={[sharedStyles.sectionTitle, { color: colors.text }]}>{title}</Text><Text style={[sharedStyles.sectionBody, { color: colors.muted }]}>{body}</Text></View></View>;
}

function ToggleRow({ title, body, value, onValueChange, warning = false }: { title: string; body: string; value: boolean; onValueChange: (value: boolean) => void; warning?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.toggleRow}><View style={styles.toggleCopy}><View style={styles.toggleTitleRow}><Text style={styles.toggleTitle}>{title}</Text>{warning ? <MaterialIcons name="warning-amber" size={16} color={colors.orangeDark} /> : null}</View><Text style={styles.toggleBody}>{body}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.teal }} thumbColor={value ? colors.white : colors.muted} /></View>;
}

function InputField({ label, body, error, multiline = false, ...props }: { label: string; body?: string; error?: string; multiline?: boolean } & React.ComponentProps<typeof TextInput>) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{body ? <Text style={styles.fieldBody}>{body}</Text> : null}<TextInput {...props} multiline={multiline} placeholderTextColor={colors.muted} style={[styles.input, multiline && styles.multiline, error && styles.inputError]} />{error ? <FieldError message={error} /> : null}</View>;
}

function ChoiceField({ label, body, value, options, labels, onChange }: { label: string; body: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldBody}>{body}</Text><View style={styles.choices}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceActive]}><Text style={[styles.choiceText, value === option && styles.choiceTextActive]}>{labels?.[option] || option}</Text></Pressable>)}</View></View>;
}

function OwnerSelector({ label, value, currentLabel, message, options, onSelect, error, disabled = false }: { label: string; value: string | null; currentLabel: string; message: string; options: AdminSettingsOwnershipOption[]; onSelect: (value: string | null) => void; error?: string; disabled?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  return <AdminCard><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.ownerCurrent}>{currentLabel}</Text><Text style={styles.fieldBody}>{message}</Text><Pressable disabled={disabled} onPress={() => setExpanded((current) => !current)} style={[styles.ownerButton, disabled && styles.disabled]}><Text style={styles.ownerButtonText}>{expanded ? "Close account list" : "Choose account"}</Text><MaterialIcons name={expanded ? "expand-less" : "expand-more"} size={20} color={colors.tealDark} /></Pressable>{expanded && !disabled ? <View style={styles.ownerList}><Pressable onPress={() => { onSelect(null); setExpanded(false); }} style={[styles.ownerOption, value === null && styles.ownerOptionActive]}><Text style={styles.ownerOptionText}>No owner selected</Text></Pressable>{options.map((option) => <Pressable key={option.id} onPress={() => { onSelect(option.id); setExpanded(false); }} style={[styles.ownerOption, value === option.id && styles.ownerOptionActive]}><Text style={styles.ownerOptionText}>{option.label}</Text></Pressable>)}</View> : null}{error ? <FieldError message={error} /> : null}</AdminCard>;
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return <View style={sharedStyles.readOnlyRow}><Text style={[sharedStyles.readOnlyLabel, { color: colors.muted }]}>{label}</Text><Text style={[sharedStyles.readOnlyValue, { color: colors.text }]}>{value}</Text></View>;
}

function FieldError({ message }: { message: string }) {
  const { colors } = useAppTheme();
  return <View style={sharedStyles.fieldError}><MaterialIcons name="error-outline" size={15} color={colors.danger} /><Text style={[sharedStyles.fieldErrorText, { color: colors.danger }]}>{message}</Text></View>;
}

function StatusNotice({ tone, icon, text }: { tone: "error" | "success" | "warning"; icon: React.ComponentProps<typeof MaterialIcons>["name"]; text: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const color = tone === "error" ? colors.danger : tone === "success" ? colors.success : colors.orangeDark;
  return <View style={[styles.status, tone === "error" && styles.statusError, tone === "warning" && styles.statusWarning]}><MaterialIcons name={icon} size={20} color={color} /><Text style={[styles.statusText, { color }]}>{text}</Text></View>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-JM", { dateStyle: "medium", timeStyle: "short" });
}

const sharedStyles = StyleSheet.create({
  sectionIntro: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 2 },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: "900" },
  sectionBody: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  cardTitle: { fontSize: 18, fontWeight: "900" },
  cardBody: { fontSize: 11, lineHeight: 18, marginTop: 7 },
  readOnlyRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  readOnlyLabel: { flex: 1, fontSize: 11 },
  readOnlyValue: { flex: 1, fontSize: 11, fontWeight: "900", textAlign: "right" },
  readOnlyNote: { fontSize: 10, lineHeight: 16, marginTop: 9 },
  fieldError: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  fieldErrorText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: "700" },
});

const makeStyles = (colors: AppColors) => StyleSheet.create({
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 80 },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  status: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surface },
  statusError: { borderColor: colors.danger },
  statusWarning: { borderColor: colors.orange },
  statusText: { flex: 1, fontSize: 11, lineHeight: 17, fontWeight: "800" },
  metaCard: { padding: 15 },
  metaTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  metaIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  metaCopy: { flex: 1 },
  metaTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  metaText: { color: colors.muted, fontSize: 9, marginTop: 4 },
  liveBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.cream },
  liveBadgeText: { color: colors.success, fontSize: 8, fontWeight: "900" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tab: { minHeight: 40, paddingHorizontal: 11, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 6 },
  tabActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  tabText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  tabTextActive: { color: colors.white },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  toggleCopy: { flex: 1 },
  toggleTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  toggleTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  toggleBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  field: { marginTop: 14 },
  fieldLabel: { color: colors.text, fontSize: 11, fontWeight: "900" },
  fieldBody: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  input: { minHeight: 49, marginTop: 8, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 12 },
  multiline: { minHeight: 94, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  choice: { minWidth: 45, paddingHorizontal: 11, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  choiceActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  choiceText: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  choiceTextActive: { color: colors.white },
  ownerCurrent: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 8 },
  ownerButton: { minHeight: 43, marginTop: 12, paddingHorizontal: 13, borderRadius: radii.md, backgroundColor: colors.cream, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ownerButtonText: { color: colors.tealDark, fontSize: 10, fontWeight: "900" },
  ownerList: { gap: 7, marginTop: 9 },
  ownerOption: { padding: 11, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft },
  ownerOptionActive: { borderColor: colors.teal, backgroundColor: colors.cream },
  ownerOptionText: { color: colors.text, fontSize: 10, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  saveCard: { borderColor: colors.teal },
  saveHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  saveCopy: { flex: 1 },
  saveTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  saveText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
});

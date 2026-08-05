import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/components/ThemeProvider";
import { radii, type AppColors } from "@/constants/theme";

type CalendarPickerProps = {
  pickupDate: string;
  returnDate: string;
  minimumDays: number;
  onChange: (pickupDate: string, returnDate: string) => void;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateInput(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value: string, days: number) {
  const date = fromDateInput(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function friendlyDate(value: string, placeholder: string) {
  const date = fromDateInput(value);
  return date
    ? date.toLocaleDateString("en-JM", { weekday: "short", month: "short", day: "numeric" })
    : placeholder;
}

export function CalendarPicker({ pickupDate, returnDate, minimumDays, onChange }: CalendarPickerProps) {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const today = useMemo(() => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return now;
  }, []);
  const initialDate = fromDateInput(pickupDate) ?? today;
  const [month, setMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12));
  const [selecting, setSelecting] = useState<"pickup" | "return">(pickupDate && !returnDate ? "return" : "pickup");
  const [message, setMessage] = useState("Choose your pickup date to begin.");

  const days = useMemo(() => {
    const firstWeekday = month.getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1, 12)),
    ];
  }, [month]);

  const selectDate = (date: Date) => {
    const value = toDateInput(date);
    if (date < today) return;

    if (value === pickupDate) {
      onChange("", "");
      setSelecting("pickup");
      setMessage("Pickup cleared. Choose a new pickup date.");
      return;
    }

    if (value === returnDate) {
      onChange(pickupDate, "");
      setSelecting("return");
      setMessage(`Return cleared. Choose a date at least ${minimumDays} ${minimumDays === 1 ? "day" : "days"} after pickup.`);
      return;
    }

    if (selecting === "pickup" || !pickupDate) {
      onChange(value, "");
      setSelecting("return");
      setMessage(`Now choose a return date at least ${minimumDays} ${minimumDays === 1 ? "day" : "days"} later.`);
      return;
    }

    const earliestReturn = addDays(pickupDate, minimumDays);
    if (value < earliestReturn) {
      setMessage(`Return must be ${minimumDays} ${minimumDays === 1 ? "day" : "days"} or more after pickup.`);
      return;
    }
    onChange(pickupDate, value);
    setSelecting("pickup");
    setMessage("Dates selected. Live availability will be refreshed.");
  };

  const previousMonth = () => {
    const previous = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    if (previous < currentMonth) return;
    setMonth(previous);
  };

  const nextMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12));

  return (
    <View>
      <View style={styles.dateFields}>
        <Pressable style={[styles.dateField, selecting === "pickup" && styles.dateFieldActive]} onPress={() => setSelecting("pickup")} accessibilityRole="button">
          <Text style={styles.dateLabel}>PICKUP</Text>
          <Text style={styles.dateValue}>{friendlyDate(pickupDate, "Select date")}</Text>
        </Pressable>
        <Text style={styles.dateArrow}>→</Text>
        <Pressable style={[styles.dateField, selecting === "return" && styles.dateFieldActive]} onPress={() => pickupDate && setSelecting("return")} accessibilityRole="button">
          <Text style={styles.dateLabel}>RETURN</Text>
          <Text style={styles.dateValue}>{friendlyDate(returnDate, "Select date")}</Text>
        </Pressable>
      </View>

      <View style={styles.calendar}>
        <View style={styles.monthHeader}>
          <Pressable onPress={previousMonth} style={styles.monthButton} accessibilityRole="button" accessibilityLabel="Previous month"><Text style={styles.monthButtonText}>‹</Text></Pressable>
          <Text style={styles.monthTitle}>{month.toLocaleDateString("en-JM", { month: "long", year: "numeric" })}</Text>
          <Pressable onPress={nextMonth} style={styles.monthButton} accessibilityRole="button" accessibilityLabel="Next month"><Text style={styles.monthButtonText}>›</Text></Pressable>
        </View>
        <View style={styles.weekRow}>{WEEKDAYS.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.dayGrid}>
          {days.map((date, index) => {
            if (!date) return <View key={`blank-${index}`} style={styles.dayCell} />;
            const value = toDateInput(date);
            const disabled = date < today;
            const endpoint = value === pickupDate || value === returnDate;
            const inRange = Boolean(pickupDate && returnDate && value > pickupDate && value < returnDate);
            return (
              <Pressable key={value} disabled={disabled} onPress={() => selectDate(date)} style={[styles.dayCell, inRange && styles.dayInRange, endpoint && styles.daySelected]} accessibilityRole="button" accessibilityLabel={date.toLocaleDateString("en-JM", { month: "long", day: "numeric", year: "numeric" })}>
                <Text style={[styles.dayText, disabled && styles.dayDisabled, endpoint && styles.dayTextSelected]}>{date.getDate()}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const makeStyles = (colors: AppColors, isDark: boolean) => StyleSheet.create({
  dateFields: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  dateField: { flex: 1, minHeight: 68, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, backgroundColor: colors.surfaceSoft },
  dateFieldActive: { borderColor: colors.teal, backgroundColor: isDark ? colors.navySoft : "#ECF7F3" },
  dateLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  dateValue: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 7 },
  dateArrow: { color: colors.teal, fontSize: 18, fontWeight: "800" },
  calendar: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, backgroundColor: colors.surface },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  monthButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft },
  monthButtonText: { color: colors.tealDark, fontSize: 28, lineHeight: 30 },
  monthTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  weekRow: { flexDirection: "row", marginBottom: 4 },
  weekday: { width: "14.285%", color: colors.muted, textAlign: "center", fontSize: 11, fontWeight: "800" },
  dayGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.285%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  dayInRange: { borderRadius: 0, backgroundColor: isDark ? colors.navySoft : "#E6F3EE" },
  daySelected: { backgroundColor: colors.teal },
  dayText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  dayDisabled: { color: isDark ? "#516075" : "#C4CBD4" },
  dayTextSelected: { color: colors.white, fontWeight: "900" },
  message: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
});

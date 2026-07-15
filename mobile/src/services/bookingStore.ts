import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { BookingCreateResult } from "@/services/api";

const CURRENT_BOOKING_KEY = "curated.current-booking.v1";

export type SavedBooking = BookingCreateResult & {
  savedAt: string;
};

export async function saveCurrentBooking(booking: BookingCreateResult) {
  const value: SavedBooking = { ...booking, savedAt: new Date().toISOString() };
  if (Platform.OS === "web") return value;
  await SecureStore.setItemAsync(CURRENT_BOOKING_KEY, JSON.stringify(value));
  return value;
}

export async function getCurrentBooking(): Promise<SavedBooking | null> {
  if (Platform.OS === "web") return null;
  const value = await SecureStore.getItemAsync(CURRENT_BOOKING_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SavedBooking>;
    if (typeof parsed.bookingId !== "string" || typeof parsed.bookingAccessToken !== "string") {
      await SecureStore.deleteItemAsync(CURRENT_BOOKING_KEY);
      return null;
    }
    return parsed as SavedBooking;
  } catch {
    await SecureStore.deleteItemAsync(CURRENT_BOOKING_KEY);
    return null;
  }
}

export async function clearCurrentBooking() {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(CURRENT_BOOKING_KEY);
}

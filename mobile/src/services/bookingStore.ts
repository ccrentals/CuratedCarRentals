import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { BookingCreateResult } from "@/services/api";

const LEGACY_BOOKING_KEY = "curated.current-booking.v1";
const SAVED_BOOKINGS_KEY = "curated.saved-bookings.v2";
const MAX_SAVED_BOOKINGS = 20;

export type SavedBookingDetails = {
  vehicleName?: string;
  startDate?: string;
  endDate?: string;
};

export type SavedBooking = BookingCreateResult & SavedBookingDetails & {
  savedAt: string;
};

function isSavedBooking(value: unknown): value is SavedBooking {
  if (!value || typeof value !== "object") return false;
  const booking = value as Partial<SavedBooking>;
  return typeof booking.bookingId === "string"
    && typeof booking.bookingAccessToken === "string"
    && typeof booking.status === "string"
    && typeof booking.savedAt === "string";
}

function parseSavedBookings(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isSavedBooking) : [];
  } catch {
    return [];
  }
}

async function writeBookings(bookings: SavedBooking[]) {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(SAVED_BOOKINGS_KEY, JSON.stringify(bookings.slice(0, MAX_SAVED_BOOKINGS)));
}

export async function getSavedBookings(): Promise<SavedBooking[]> {
  if (Platform.OS === "web") return [];
  const stored = parseSavedBookings(await SecureStore.getItemAsync(SAVED_BOOKINGS_KEY));
  if (stored.length > 0) return stored.sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const legacyValue = await SecureStore.getItemAsync(LEGACY_BOOKING_KEY);
  if (!legacyValue) return [];
  const legacy = parseSavedBookings(`[${legacyValue}]`);
  if (legacy.length === 0) {
    await SecureStore.deleteItemAsync(LEGACY_BOOKING_KEY);
    return [];
  }

  await writeBookings(legacy);
  await SecureStore.deleteItemAsync(LEGACY_BOOKING_KEY);
  return legacy;
}

export async function saveCurrentBooking(booking: BookingCreateResult, details: SavedBookingDetails = {}) {
  const value: SavedBooking = { ...booking, ...details, savedAt: new Date().toISOString() };
  if (Platform.OS === "web") return value;
  const current = await getSavedBookings();
  const next = [value, ...current.filter((item) => item.bookingId !== value.bookingId)];
  await writeBookings(next);
  return value;
}

export async function removeSavedBooking(bookingId: string) {
  if (Platform.OS === "web") return [];
  const next = (await getSavedBookings()).filter((item) => item.bookingId !== bookingId);
  await writeBookings(next);
  return next;
}

export async function clearAllSavedBookings() {
  if (Platform.OS === "web") return;
  await Promise.all([
    SecureStore.deleteItemAsync(SAVED_BOOKINGS_KEY),
    SecureStore.deleteItemAsync(LEGACY_BOOKING_KEY),
  ]);
}

export async function getCurrentBooking() {
  return (await getSavedBookings())[0] ?? null;
}

export async function clearCurrentBooking() {
  const current = await getCurrentBooking();
  if (current) await removeSavedBooking(current.bookingId);
}

import type { AdminBookingLocation, AdminQuoteCreateInput } from "./api";

export type LocationValues = Record<string, string>;
export type CreationContext = { pickupDate: string; pickupTime: string; dropoffDate: string; dropoffTime: string };

export function locationsForSide(locations: AdminBookingLocation[], side: "pickup" | "dropoff") { return locations.filter((location) => location.isActive && (side === "pickup" ? location.appliesToPickup : location.appliesToDropoff)); }
export function locationForType(locations: AdminBookingLocation[], typeKey: string, side: "pickup" | "dropoff") { const options = locationsForSide(locations, side); return options.find((location) => location.locationTypeKey === typeKey) ?? options[0] ?? null; }
export function locationFields(location: AdminBookingLocation | null, side: "pickup" | "dropoff") { return location?.fieldSchema.filter((field) => field.appliesTo === side || field.appliesTo === "both") ?? []; }

function defaultValue(source: AdminBookingLocation["fieldSchema"][number]["defaultSource"], context: CreationContext) { if (source === "pickup_date") return context.pickupDate; if (source === "pickup_time") return context.pickupTime; if (source === "dropoff_date") return context.dropoffDate; if (source === "dropoff_time") return context.dropoffTime; return ""; }
export function coerceLocationValues(location: AdminBookingLocation | null, side: "pickup" | "dropoff", values: LocationValues, context: CreationContext) { return Object.fromEntries(locationFields(location, side).map((field) => [field.key, values[field.key]?.trim() || defaultValue(field.defaultSource, context)])); }
export function validateLocation(location: AdminBookingLocation | null, side: "pickup" | "dropoff", values: LocationValues) { if (!location) return `Choose a ${side} location.`; const missing = locationFields(location, side).find((field) => field.required && !values[field.key]?.trim()); return missing ? `${missing.label} is required.` : null; }

export function buildLocationSelection(input: { locations: AdminBookingLocation[]; pickupTypeKey: string; dropoffTypeKey: string; pickupValues: LocationValues; dropoffValues: LocationValues; context: CreationContext }) {
  const pickup = locationForType(input.locations, input.pickupTypeKey, "pickup"); const dropoff = locationForType(input.locations, input.dropoffTypeKey, "dropoff");
  const pickupValues = coerceLocationValues(pickup, "pickup", input.pickupValues, input.context); const dropoffValues = coerceLocationValues(dropoff, "dropoff", input.dropoffValues, input.context);
  const pickupText = pickupValues.address?.trim() || pickup?.pickupLabel || ""; const dropoffText = dropoffValues.address?.trim() || dropoff?.dropoffLabel || "";
  const entry = (location: AdminBookingLocation | null, side: "pickup" | "dropoff", values: LocationValues) => ({ type: location?.locationTypeKey || "CUSTOM_ADDRESS", typeKey: location?.locationTypeKey || "CUSTOM_ADDRESS", label: side === "pickup" ? location?.pickupLabel || "Pickup" : location?.dropoffLabel || "Dropoff", locationId: location?.id ?? null, values, fieldLabels: Object.fromEntries(locationFields(location, side).map((field) => [field.key, field.label])), address: values.address || null, flightDate: values.flight_date || null, flightTime: values.flight_time || null, flightNumber: values.flight_number || null, airline: values.airline || null });
  return { pickup, dropoff, pickupValues, dropoffValues, pickupText, dropoffText, details: { pickup: entry(pickup, "pickup", pickupValues), dropoff: entry(dropoff, "dropoff", dropoffValues) } };
}

export function jamaicaDateTimeIso(date: string, time: string): string | null { if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null; const parsed = new Date(`${date}T${time}:00-05:00`); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
export function jamaicaEndOfDayIso(date: string): string | null { return jamaicaDateTimeIso(date, "23:59"); }
export function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }

export function prepareQuoteCreate(input: {
  customerFullName: string; customerEmail: string; customerPhone: string; pickupDate: string; pickupTime: string; dropoffDate: string; dropoffTime: string;
  locations: AdminBookingLocation[]; pickupTypeKey: string; dropoffTypeKey: string; pickupValues: LocationValues; dropoffValues: LocationValues;
  vehicleId: string; insuranceEnabled: boolean; insurancePlanId: string | null; promoCode: string; tags: string; comments: string; expiresDate: string;
  commissionPartnerName: string; clientPaysAtPartner: boolean; rackPrice: string;
}): { ok: true; payload: AdminQuoteCreateInput } | { ok: false; error: string } {
  const startAt = jamaicaDateTimeIso(input.pickupDate, input.pickupTime); const endAt = jamaicaDateTimeIso(input.dropoffDate, input.dropoffTime);
  if (input.customerFullName.trim().length < 2) return { ok: false, error: "Enter the customer’s full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail.trim())) return { ok: false, error: "Enter a valid customer email." };
  if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) return { ok: false, error: "Return date and time must be later than pickup." };
  if (!input.vehicleId) return { ok: false, error: "Choose an available vehicle." };
  const context = { pickupDate: input.pickupDate, pickupTime: input.pickupTime, dropoffDate: input.dropoffDate, dropoffTime: input.dropoffTime };
  const selection = buildLocationSelection({ locations: input.locations, pickupTypeKey: input.pickupTypeKey, dropoffTypeKey: input.dropoffTypeKey, pickupValues: input.pickupValues, dropoffValues: input.dropoffValues, context });
  const pickupError = validateLocation(selection.pickup, "pickup", selection.pickupValues); const dropoffError = validateLocation(selection.dropoff, "dropoff", selection.dropoffValues);
  if (pickupError || dropoffError) return { ok: false, error: pickupError || dropoffError || "Complete the location details." };
  if (input.insuranceEnabled && !input.insurancePlanId) return { ok: false, error: "The selected protection option is unavailable." };
  const expiresAt = input.expiresDate.trim() ? jamaicaEndOfDayIso(input.expiresDate.trim()) : null; if (input.expiresDate.trim() && !expiresAt) return { ok: false, error: "Use a valid quote expiry date." };
  const rackPrice = input.rackPrice.trim() ? Number(input.rackPrice.replaceAll(",", "")) : null; if (rackPrice !== null && (!Number.isInteger(rackPrice) || rackPrice < 0)) return { ok: false, error: "Rack price must be a non-negative whole JMD amount." };
  return { ok: true, payload: { customerFullName: input.customerFullName.trim(), customerEmail: input.customerEmail.trim().toLowerCase(), customerPhone: input.customerPhone.trim() || null, startAt, endAt, pickupLocationId: selection.pickup?.id ?? null, dropoffLocationId: selection.dropoff?.id ?? null, pickupLocationText: selection.pickupText, dropoffLocationText: selection.dropoffText, pickupLocationType: selection.pickup?.locationTypeKey || input.pickupTypeKey, dropoffLocationType: selection.dropoff?.locationTypeKey || input.dropoffTypeKey, pickupLocationTextSnapshot: selection.pickupText, dropoffLocationTextSnapshot: selection.dropoffText, bookingLocationDetails: selection.details, vehicleId: input.vehicleId, insuranceEnabled: input.insuranceEnabled, insurancePlanId: input.insuranceEnabled ? input.insurancePlanId : null, promoCode: input.promoCode.trim().toUpperCase() || null, tags: [...new Set(input.tags.split(/[\n,]+/).map((tag) => tag.trim()).filter(Boolean))], comments: input.comments.trim() || null, expiresAt, commissionPartnerName: input.commissionPartnerName.trim() || null, clientPaysAtPartner: input.clientPaysAtPartner, rackPriceCents: rackPrice } };
}

export default { locationsForSide, locationForType, locationFields, coerceLocationValues, validateLocation, buildLocationSelection, jamaicaDateTimeIso, prepareQuoteCreate };

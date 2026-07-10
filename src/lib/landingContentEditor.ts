export type LandingEditableValue =
  | string
  | number
  | boolean
  | null
  | LandingEditableValue[]
  | { [key: string]: LandingEditableValue };

export const MAX_LANDING_EDITOR_ITEMS = 50;
export const LANDING_SOCIAL_ICON_OPTIONS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "X / Twitter" },
  { value: "youtube", label: "YouTube" },
] as const;

export type LandingAddItemConfig = {
  title: string;
  description: string;
  itemLabel: string;
  fieldOrder?: string[];
  multiline?: boolean;
};

const ADD_ITEM_CONFIGS: Record<string, LandingAddItemConfig> = {
  "global.phones": {
    title: "Add phone number",
    description: "Enter the displayed number and its telephone link.",
    itemLabel: "Phone number",
    fieldOrder: ["label", "href"],
  },
  "global.addressLines": {
    title: "Add address line",
    description: "Add another line to the address shown in the footer.",
    itemLabel: "Address line",
  },
  "global.whatsapps": {
    title: "Add WhatsApp number",
    description: "Enter the displayed number and its wa.me link.",
    itemLabel: "WhatsApp number",
    fieldOrder: ["label", "href"],
  },
  "global.navigation": {
    title: "Add navigation link",
    description: "Add a label and destination to the public site navigation.",
    itemLabel: "Navigation link",
    fieldOrder: ["label", "href"],
  },
  "global.footerQuickLinks": {
    title: "Add footer link",
    description: "Add a label and destination to the footer quick links.",
    itemLabel: "Footer link",
    fieldOrder: ["label", "href"],
  },
  "global.footerLegalLinks": {
    title: "Add legal link",
    description: "Add a label and destination to the footer legal links.",
    itemLabel: "Legal link",
    fieldOrder: ["label", "href"],
  },
  "global.socialLinks": {
    title: "Add social link",
    description: "Choose the platform, then enter its public profile URL and accessible label.",
    itemLabel: "Social link",
    fieldOrder: ["icon", "label", "href"],
  },
  "home.aboutFeatures": {
    title: "Add feature",
    description: "Add a feature title and supporting description to the home page.",
    itemLabel: "Feature",
    fieldOrder: ["title", "description"],
  },
  "home.testimonials": {
    title: "Add testimonial",
    description: "Add the customer's name, location, quote, and profile image.",
    itemLabel: "Testimonial",
    fieldOrder: ["name", "location", "quote", "avatar"],
  },
  "services.items": {
    title: "Add service",
    description: "Create a service card with a unique URL ID, copy, and image.",
    itemLabel: "Service",
    fieldOrder: ["id", "title", "description", "imageSrc", "imageAlt"],
  },
  "touristDestinations.items": {
    title: "Add destination",
    description: "Create a destination card with its location, description, and image.",
    itemLabel: "Destination",
    fieldOrder: ["name", "location", "description", "imageSrc"],
  },
  "driving.tips": {
    title: "Add driving tip",
    description: "Add a heading, explanation, and concise tip for visitors.",
    itemLabel: "Driving tip",
    fieldOrder: ["title", "description", "tip"],
  },
  "about.features": {
    title: "Add feature",
    description: "Add a feature title and supporting description to the About page.",
    itemLabel: "Feature",
    fieldOrder: ["title", "description"],
  },
  "about.mission": {
    title: "Add mission paragraph",
    description: "Add another paragraph to the company mission.",
    itemLabel: "Mission paragraph",
    multiline: true,
  },
  "contact.beforeYouSendParagraphs": {
    title: "Add guidance paragraph",
    description: "Add guidance shown before a customer sends a message.",
    itemLabel: "Guidance paragraph",
    multiline: true,
  },
  "contact.reassuranceItems": {
    title: "Add reassurance item",
    description: "Add a support benefit and its description.",
    itemLabel: "Reassurance item",
    fieldOrder: ["title", "description"],
  },
  "rentalPolicies.requirements": {
    title: "Add rental requirement",
    description: "Add another requirement to the rental policy.",
    itemLabel: "Requirement",
    multiline: true,
  },
  "rentalPolicies.deposit": {
    title: "Add deposit policy",
    description: "Add another security-deposit policy statement.",
    itemLabel: "Deposit policy",
    multiline: true,
  },
  "rentalPolicies.paidItems": {
    title: "Add paid-reservation benefit",
    description: "Add another benefit or condition for paid reservations.",
    itemLabel: "Paid-reservation item",
    multiline: true,
  },
  "rentalPolicies.unpaidItems": {
    title: "Add unpaid-reservation condition",
    description: "Add another condition for unpaid reservations.",
    itemLabel: "Unpaid-reservation item",
    multiline: true,
  },
  "rentalPolicies.faqs": {
    title: "Add frequently asked question",
    description: "Enter the customer-facing question and its answer.",
    itemLabel: "FAQ",
    fieldOrder: ["question", "answer"],
  },
};

export const LANDING_ADD_ITEM_COLLECTION_PATHS = Object.freeze(Object.keys(ADD_ITEM_CONFIGS));

export function isLandingEditableRecord(
  value: LandingEditableValue,
): value is { [key: string]: LandingEditableValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getLandingAddItemConfig(path: Array<string | number>): LandingAddItemConfig {
  const pathKey = path.map(String).join(".");
  const fieldName = String(path[path.length - 1] ?? "item");
  return (
    ADD_ITEM_CONFIGS[pathKey] ?? {
      title: `Add ${labelizeLandingField(fieldName).toLowerCase()} item`,
      description: "Enter the content for the new item.",
      itemLabel: labelizeLandingField(fieldName),
    }
  );
}

export function labelizeLandingField(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createEmptyLandingItem(
  template: LandingEditableValue,
  fieldName = "",
): LandingEditableValue {
  if (typeof template === "string") {
    if (fieldName === "icon") return "facebook";
    return "";
  }
  if (typeof template === "number") return 0;
  if (typeof template === "boolean") return false;
  if (Array.isArray(template)) return [];
  if (isLandingEditableRecord(template)) {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, createEmptyLandingItem(value, key)]),
    );
  }
  return null;
}

export function orderLandingItemFields(
  item: { [key: string]: LandingEditableValue },
  fieldOrder: string[] = [],
) {
  const order = new Map(fieldOrder.map((fieldName, index) => [fieldName, index]));
  return Object.entries(item).sort(
    ([left], [right]) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function isSafeLandingHref(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("#")) return true;
  try {
    const url = new URL(trimmed);
    return ["https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function isSafeLandingImageSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "https:" &&
      (url.hostname === "curatedcarrentals.com" ||
        url.hostname === "ucarecdn.com" ||
        url.hostname.endsWith(".ucarecdn.com") ||
        url.hostname === "ucarecd.net" ||
        url.hostname.endsWith(".ucarecd.net"))
    );
  } catch {
    return false;
  }
}

export function validateLandingItem(
  item: LandingEditableValue,
  existingItems: LandingEditableValue[],
  fieldName = "value",
): Record<string, string> {
  const errors: Record<string, string> = {};

  function visit(value: LandingEditableValue, key: string, path: string) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        errors[path] = `${labelizeLandingField(key)} is required.`;
      } else if (key === "href" && !isSafeLandingHref(trimmed)) {
        errors[path] = "Use an internal path, HTTPS URL, email link, or telephone link.";
      } else if (["src", "imageSrc", "avatar"].includes(key) && !isSafeLandingImageSource(trimmed)) {
        errors[path] = "Upload an image or use an approved site or Uploadcare image URL.";
      } else if (key === "id" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
        errors[path] = "Use a lowercase URL ID with letters, numbers, and hyphens only.";
      } else if (
        key === "icon" &&
        !LANDING_SOCIAL_ICON_OPTIONS.some((option) => option.value === trimmed)
      ) {
        errors[path] = "Choose a supported social platform.";
      }
      return;
    }

    if (isLandingEditableRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        visit(nestedValue, nestedKey, path ? `${path}.${nestedKey}` : nestedKey);
      }
    }
  }

  visit(item, fieldName, isLandingEditableRecord(item) ? "" : "value");

  if (isLandingEditableRecord(item) && typeof item.id === "string" && item.id.trim()) {
    const duplicateId = existingItems.some(
      (existing) =>
        isLandingEditableRecord(existing) &&
        typeof existing.id === "string" &&
        existing.id.trim().toLowerCase() === item.id.trim().toLowerCase(),
    );
    if (duplicateId) errors.id = "This URL ID is already in use.";
  }

  return errors;
}

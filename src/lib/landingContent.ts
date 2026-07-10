import "server-only";

import { cache } from "react";

import {
  aboutFeatures,
  destinations,
  drivingTips,
  rentalFaqs,
  rentalPolicyDeposit,
  rentalPolicyRequirements,
  reassuranceItems,
  reservationOptions,
  siteContent,
  testimonials,
} from "@/data/content";
import { services } from "@/data/services";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

export const LANDING_CONTENT_DOCUMENT_KEY = "landing_content";
export const LANDING_CONTENT_MAX_BYTES = 250_000;

const MAX_LANDING_ARRAY_ITEMS = 50;
const MAX_LANDING_TEXT_LENGTH = 20_000;
const SAFE_SOCIAL_ICONS = new Set(["facebook", "instagram", "twitter", "youtube"]);

export type LandingLink = {
  label: string;
  href: string;
};

export type LandingImage = {
  src: string;
  alt: string;
};

export type LandingListItem = {
  title: string;
  description: string;
};

export type LandingContactLink = {
  label: string;
  href: string;
};

export type LandingSocialLink = LandingLink & {
  icon: "facebook" | "instagram" | "twitter" | "youtube";
};

export type LandingContent = {
  global: {
    brand: string;
    tagline: string;
    location: string;
    phone: string;
    phones: LandingContactLink[];
    email: string;
    address: string;
    addressLines: string[];
    whatsapp: LandingContactLink;
    whatsapps: LandingContactLink[];
    brandDescription: string;
    navigation: LandingLink[];
    headerBookLabel: string;
    headerAdminLabel: string;
    headerMenuLabel: string;
    headerCloseMenuLabel: string;
    footerQuickLinksTitle: string;
    footerServicesTitle: string;
    footerContactTitle: string;
    footerContactFormLabel: string;
    footerCopyright: string;
    footerQuickLinks: LandingLink[];
    footerLegalLinks: LandingLink[];
    socialLinks: LandingSocialLink[];
  };
  home: {
    heroEyebrow: string;
    heroHeadline: string;
    heroDescription: string;
    heroImage: LandingImage;
    primaryCta: LandingLink;
    secondaryCta: LandingLink;
    pricingNote: string;
    pricingNoteEmphasis: string;
    featuredTitle: string;
    featuredDescription: string;
    featuredEmptyText: string;
    featuredCardNote: string;
    featuredCtaLabel: string;
    featuredAllFleetLabel: string;
    discoverImage: LandingImage;
    discoverTitle: string;
    discoverDescription: string;
    aboutEyebrow: string;
    aboutHeading: string;
    aboutDescription: string;
    aboutSupport: string;
    aboutFeatures: LandingListItem[];
    bookingTitle: string;
    bookingDescription: string;
    bookingCardEyebrow: string;
    bookingCardDescription: string;
    bookingCtaLabel: string;
    testimonialsTitle: string;
    testimonialsDescription: string;
    testimonials: Array<{
      name: string;
      location: string;
      quote: string;
      avatar: string;
    }>;
    contactEyebrow: string;
    contactHeading: string;
    contactDescription: string;
    contactImage: LandingImage;
    contactVisitLabel: string;
    contactCallLabel: string;
    contactEmailLabel: string;
    contactEmailActionLabel: string;
    contactWhatsappLabel: string;
    contactSubmitLabel: string;
    contactSubmittingLabel: string;
  };
  fleet: {
    pricingNote: string;
    pricingNoteEmphasis: string;
    backLabel: string;
    title: string;
    description: string;
    emptyText: string;
    detailBackLabel: string;
    detailReserveLabel: string;
    detailPoliciesLabel: string;
    detailPricingLabel: string;
    detailPerDayLabel: string;
    detailDepositLabel: string;
    detailSpecsEyebrow: string;
    detailSpecsTitle: string;
    detailSpecsDescription: string;
    detailComfortTitle: string;
    detailTravelNoteTitle: string;
    detailTravelNoteDescription: string;
    detailContinueEyebrow: string;
    detailContinueTitle: string;
    detailContinueDescription: string;
    detailContinuePrimaryCta: LandingLink;
    detailContinueSecondaryCta: LandingLink;
  };
  services: {
    title: string;
    description: string;
    serviceCtaLabel: string;
    items: Array<{
      id: string;
      title: string;
      description: string;
      imageSrc: string;
      imageAlt: string;
    }>;
  };
  touristDestinations: {
    title: string;
    description: string;
    routeTitle: string;
    routeDescription: string;
    items: Array<{
      name: string;
      location: string;
      description: string;
      imageSrc: string;
    }>;
  };
  driving: {
    title: string;
    description: string;
    tips: Array<{
      title: string;
      description: string;
      tip: string;
    }>;
    ctaTitle: string;
    ctaDescription: string;
    primaryCta: LandingLink;
    secondaryCta: LandingLink;
  };
  about: {
    backLabel: string;
    title: string;
    intro: string;
    image: LandingImage;
    imageTitle: string;
    imageDescription: string;
    eyebrow: string;
    heading: string;
    description: string;
    support: string;
    features: LandingListItem[];
    missionTitle: string;
    mission: string[];
  };
  contact: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: LandingLink;
    secondaryCta: LandingLink;
    detailsEyebrow: string;
    detailsTitle: string;
    beforeYouSendEyebrow: string;
    beforeYouSendParagraphs: string[];
    formEyebrow: string;
    formTitle: string;
    formDescription: string;
    submitLabel: string;
    submittingLabel: string;
    formAsideText: string;
    supportEyebrow: string;
    supportTitle: string;
    supportDescription: string;
    reassuranceItems: LandingListItem[];
    ctaEyebrow: string;
    ctaTitle: string;
    ctaDescription: string;
  };
  rentalPolicies: {
    title: string;
    description: string;
    requirementsTitle: string;
    requirements: string[];
    depositTitle: string;
    deposit: string[];
    insuranceTitle: string;
    insuranceDescription: string;
    declineTitle: string;
    declineDescription: string;
    coverageTitle: string;
    coverageDescription: string;
    reservationTitle: string;
    reservationIntro: string;
    reservationOptionsTitle: string;
    paidTitle: string;
    paidItems: string[];
    unpaidTitle: string;
    unpaidItems: string[];
    airportTitle: string;
    airportNote: string;
    recommendation: string;
    faqEyebrow: string;
    faqTitle: string;
    faqs: Array<{
      question: string;
      answer: string;
    }>;
  };
};

export const DEFAULT_LANDING_CONTENT: LandingContent = {
  global: {
    brand: siteContent.brand,
    tagline: siteContent.tagline,
    location: siteContent.location,
    phone: siteContent.phone,
    phones: siteContent.phones,
    email: siteContent.email,
    address: siteContent.address,
    addressLines: siteContent.addressLines,
    whatsapp: siteContent.whatsapp,
    whatsapps: siteContent.whatsapps,
    brandDescription: siteContent.brandDescription,
    navigation: [
      { href: "/", label: "Home" },
      { href: "/fleet", label: "Fleet" },
      { href: "/services", label: "Services" },
      { href: "/rental-policies", label: "Rental Policies" },
      { href: "/driving-in-jamaica", label: "Driving in Jamaica" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
    headerBookLabel: "Book Now",
    headerAdminLabel: "Admin",
    headerMenuLabel: "Menu",
    headerCloseMenuLabel: "Close",
    footerQuickLinksTitle: "Quick Links",
    footerServicesTitle: "Our Services",
    footerContactTitle: "Contact Us",
    footerContactFormLabel: "Send a tracked message",
    footerCopyright: "Curated Car Rentals. All rights reserved.",
    footerQuickLinks: [
      { href: "/", label: "Home" },
      { href: "/fleet", label: "Our Fleet" },
      { href: "/services", label: "Services" },
      { href: "/tourist-destinations", label: "Tourist Destinations" },
      { href: "/about", label: "About Us" },
      { href: "/contact", label: "Contact" },
      { href: "/book", label: "Book Now" },
    ],
    footerLegalLinks: [
      { href: "/rental-policies", label: "Privacy Policy" },
      { href: "/rental-policies", label: "Terms & Conditions" },
      { href: "/rental-policies", label: "FAQ" },
    ],
    socialLinks: [
      { href: "https://facebook.com", label: "Facebook", icon: "facebook" },
      { href: "https://instagram.com", label: "Instagram", icon: "instagram" },
      { href: "https://twitter.com", label: "Twitter", icon: "twitter" },
      { href: "https://youtube.com", label: "YouTube", icon: "youtube" },
    ],
  },
  home: {
    heroEyebrow: `🌴 ${siteContent.location}`,
    heroHeadline: siteContent.heroHeadline,
    heroDescription: siteContent.heroDescription,
    heroImage: {
      src: "/live-site/home/hero-tropical-car.jpg",
      alt: "Modern car driving down a palm tree lined coastal road in Jamaica",
    },
    primaryCta: { label: "Book Your Vehicle", href: "/book" },
    secondaryCta: { label: "Explore Our Fleet", href: "/fleet" },
    pricingNote: "🌺 Our Simple Pricing includes all fees and taxes - No Surprises!",
    pricingNoteEmphasis: "(*optional insurance is extra)",
    featuredTitle: "Our Curated Collection",
    featuredDescription:
      "Discover our handpicked selection of premium vehicles that combine style, comfort, and reliability for your Jamaican adventure.",
    featuredEmptyText: "No vehicles are currently published. Add and publish vehicles from the Admin portal.",
    featuredCardNote:
      "Our simple pricing includes all statutory fees and taxes - (only optional Insurance is extra)",
    featuredCtaLabel: "Reserve Now",
    featuredAllFleetLabel: "View our entire fleet",
    discoverImage: {
      src: "/live-site/home/discover-jamaica.png",
      alt: "Exploring Jamaica with Curated Car Rentals",
    },
    discoverTitle: "Discover Jamaica",
    discoverDescription:
      "From Kingston's vibrant streets to stunning coastal drives, our vehicles are your passport to Jamaica's wonders.",
    aboutEyebrow: "About Us",
    aboutHeading: siteContent.aboutHeading,
    aboutDescription: siteContent.aboutDescription,
    aboutSupport: siteContent.aboutSupport,
    aboutFeatures,
    bookingTitle: siteContent.homeBookingTitle,
    bookingDescription: siteContent.homeBookingDescription,
    bookingCardEyebrow: "Integrated Booking",
    bookingCardDescription:
      "Reserve your perfect vehicle using our current booking flow. Vehicle inventory, published pricing, and backend-fed images remain connected to the live system.",
    bookingCtaLabel: "Book Your Vehicle",
    testimonialsTitle: "What Our Customers Say",
    testimonialsDescription:
      "Discover why travelers choose Curated Car Rentals for their Jamaican adventures.",
    testimonials,
    contactEyebrow: "Get In Touch",
    contactHeading: siteContent.contactHeading,
    contactDescription: siteContent.contactDescription,
    contactImage: {
      src: "/live-site/home/discover-jamaica.png",
      alt: "Exploring Jamaica with Curated Car Rentals",
    },
    contactVisitLabel: "Visit Us",
    contactCallLabel: "Call Us",
    contactEmailLabel: "Email Us",
    contactEmailActionLabel: "Send a tracked message",
    contactWhatsappLabel: "WhatsApp",
    contactSubmitLabel: "Send Message",
    contactSubmittingLabel: "Sending...",
  },
  fleet: {
    pricingNote: "Our Simple Pricing includes all fees and taxes - No Surprises!",
    pricingNoteEmphasis: "(*optional insurance is extra)",
    backLabel: "Back to home",
    title: "Our Complete Fleet",
    description:
      "Browse our entire collection of premium vehicles available for your Jamaican adventure. From economic options to luxury rides, we have the perfect car for your needs.",
    emptyText: "No vehicles are currently published. Add and publish vehicles from the Admin portal.",
    detailBackLabel: "Back to Fleet",
    detailReserveLabel: "Reserve This Car",
    detailPoliciesLabel: "Rental Policies",
    detailPricingLabel: "Pricing",
    detailPerDayLabel: "per day",
    detailDepositLabel: "Deposit",
    detailSpecsEyebrow: "Vehicle Details",
    detailSpecsTitle: "Comfort, practicality, and clear rental information.",
    detailSpecsDescription:
      "Everything below keeps the booking decision simple while preserving the live vehicle data from the backend.",
    detailComfortTitle: "Comfort & Practicality",
    detailTravelNoteTitle: "Travel note",
    detailTravelNoteDescription:
      "For pricing, pickup details, and reservation guidance, continue to booking or review the rental policies before confirming your vehicle.",
    detailContinueEyebrow: "Continue Exploring",
    detailContinueTitle: "Want to compare this vehicle with the rest of the fleet?",
    detailContinueDescription:
      "Return to the full collection or move straight to booking when you're ready to secure your dates.",
    detailContinuePrimaryCta: { href: "/fleet", label: "Back to Fleet" },
    detailContinueSecondaryCta: { href: "/book", label: "Book This Vehicle" },
  },
  services: {
    title: "Our Services",
    description:
      "At Curated Car Rentals, we offer more than just vehicles. Discover our premium services designed to make your Jamaican journey exceptional.",
    serviceCtaLabel: "Book This Service",
    items: services.map((service) => ({
      id: service.id,
      title: service.title,
      description: service.description,
      imageSrc: service.imageSrc,
      imageAlt: service.imageAlt,
    })),
  },
  touristDestinations: {
    title: "Tourist Destinations",
    description:
      "Discover Jamaica's most breathtaking locations, from pristine beaches to historic landmarks.",
    routeTitle: "Plan your island route",
    routeDescription:
      "Explore the destinations below and use the fleet to build a route that fits your stay, whether you want scenic day drives, beach stops, mountain views, or historic tours.",
    items: destinations,
  },
  driving: {
    title: "Driving in Jamaica",
    description: "Essential information for a safe and enjoyable driving experience on the island.",
    tips: drivingTips,
    ctaTitle: "Ready for your Jamaican road trip?",
    ctaDescription: "Let us help you select the perfect vehicle for your adventure.",
    primaryCta: { label: "Book Your Car Now", href: "/book" },
    secondaryCta: { label: "View Fleet", href: "/fleet" },
  },
  about: {
    backLabel: "Back to home",
    title: "About Us",
    intro: siteContent.aboutIntro,
    image: {
      src: "/live-site/home/discover-jamaica.png",
      alt: "Exploring Jamaica with Curated Car Rentals",
    },
    imageTitle: "Discover Jamaica",
    imageDescription:
      "From Kingston's vibrant streets to stunning coastal drives, our vehicles are your passport to Jamaica's wonders.",
    eyebrow: "About Us",
    heading: siteContent.aboutHeading,
    description: siteContent.aboutDescription,
    support: siteContent.aboutSupport,
    features: aboutFeatures,
    missionTitle: "Our Mission",
    mission: siteContent.mission,
  },
  contact: {
    eyebrow: "Contact",
    title: "Get in touch with Curated Car Rentals",
    description:
      "Reach out for booking questions, vehicle guidance, airport pickup support, or help planning the right rental for your trip.",
    primaryCta: { label: "Start Your Booking", href: "/book" },
    secondaryCta: { label: "Browse Fleet", href: "/fleet" },
    detailsEyebrow: "Contact Details",
    detailsTitle: "Call or WhatsApp",
    beforeYouSendEyebrow: "Before You Send",
    beforeYouSendParagraphs: [
      "Share your travel dates, pickup area, and the type of vehicle you are considering so our team can guide you quickly.",
      "If you are coordinating airport pickup, corporate travel, or a longer rental, note that in your message and we'll point you to the best next step.",
    ],
    formEyebrow: "Secure Message Form",
    formTitle: "Send a message",
    formDescription:
      "Use the form below for inquiries and booking questions. Your message is protected by our security checks before it reaches the team.",
    submitLabel: "Send Inquiry",
    submittingLabel: "Sending...",
    formAsideText:
      "Prefer to book right away? Start your reservation online and contact us if you need help.",
    supportEyebrow: "Why Guests Reach Out",
    supportTitle: "Helpful support before, during, and after your reservation.",
    supportDescription:
      "The same straightforward service we bring to the fleet and booking experience should be visible when you need answers.",
    reassuranceItems,
    ctaEyebrow: "Ready When You Are",
    ctaTitle: "Browse the fleet or start your reservation when you feel ready.",
    ctaDescription:
      "If you already know your dates, head to booking. If you are still comparing options, explore the fleet first and return when you are ready to reserve.",
  },
  rentalPolicies: {
    title: "Rental Policies",
    description: "You can check available bookings, dates, and pricing directly on our website.",
    requirementsTitle: "Two Forms of ID Required",
    requirements: rentalPolicyRequirements,
    depositTitle: "Security Deposit",
    deposit: rentalPolicyDeposit,
    insuranceTitle: "Insurance Coverage Terms",
    insuranceDescription:
      "Customers must choose one of the following insurance options before taking possession of the vehicle.",
    declineTitle: "Decline CDW (Collision Damage Waiver)",
    declineDescription:
      "If you decline the CDW, you will be responsible for the full amount of any damage up to the total cost of the vehicle, along with any subsequent loss of use while the vehicle is out of service.",
    coverageTitle: "Choose Insurance Coverage",
    coverageDescription:
      "If you choose the insurance coverage, you will only be responsible for the deductible of the first JMD 155,000.00 in the event of damage.",
    reservationTitle: "📢 Online Booking & Reservation Notice",
    reservationIntro: reservationOptions.intro,
    reservationOptionsTitle: "Reservation Options ✨",
    paidTitle: "✅ Paid Reservation",
    paidItems: reservationOptions.paid,
    unpaidTitle: "⚠️ Non-Paid Reservation",
    unpaidItems: reservationOptions.unpaid,
    airportTitle: "✈️ Airport Pickup Policy",
    airportNote: reservationOptions.airportPickupNote,
    recommendation: reservationOptions.recommendation,
    faqEyebrow: "Frequently Asked Questions",
    faqTitle: "Rental questions, answered clearly",
    faqs: [...rentalFaqs],
  },
};

type LandingContentDocumentRow = {
  content: string | null;
  updated_at: string | null;
  updated_by_email?: string | null;
};

export function createDefaultLandingContent(): LandingContent {
  return JSON.parse(JSON.stringify(DEFAULT_LANDING_CONTENT)) as LandingContent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSafeHref(value: string) {
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

function isSafeImageSource(value: string) {
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

function mergeValue(defaultValue: unknown, inputValue: unknown, fieldName = ""): unknown {
  if (typeof defaultValue === "string") {
    if (typeof inputValue !== "string" || inputValue.length > MAX_LANDING_TEXT_LENGTH) {
      return defaultValue;
    }
    const trimmed = inputValue.trim();
    if (fieldName === "href" && !isSafeHref(trimmed)) return defaultValue;
    if (["src", "imageSrc", "avatar"].includes(fieldName) && !isSafeImageSource(trimmed)) {
      return defaultValue;
    }
    if (fieldName === "icon" && !SAFE_SOCIAL_ICONS.has(inputValue)) return defaultValue;
    return fieldName === "href" || ["src", "imageSrc", "avatar"].includes(fieldName)
      ? trimmed
      : inputValue;
  }
  if (typeof defaultValue === "number") {
    return typeof inputValue === "number" && Number.isFinite(inputValue)
      ? inputValue
      : defaultValue;
  }
  if (typeof defaultValue === "boolean") {
    return typeof inputValue === "boolean" ? inputValue : defaultValue;
  }
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(inputValue)) return defaultValue;
    const template = defaultValue[0];
    const values = inputValue.slice(0, MAX_LANDING_ARRAY_ITEMS);
    if (template === undefined) return values;
    return values.map((item) => mergeValue(template, item, fieldName));
  }
  const defaultRecord = asRecord(defaultValue);
  if (defaultRecord) {
    const inputRecord = asRecord(inputValue) ?? {};
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaultRecord)) {
      merged[key] = mergeValue(value, inputRecord[key], key);
    }
    return merged;
  }
  return inputValue ?? defaultValue;
}

export function normalizeLandingContentValue(raw: unknown): LandingContent {
  return mergeValue(createDefaultLandingContent(), raw) as LandingContent;
}

export function parseLandingContentDocument(content: unknown): LandingContent {
  if (typeof content !== "string" || !content.trim()) {
    return createDefaultLandingContent();
  }
  try {
    return normalizeLandingContentValue(JSON.parse(content));
  } catch {
    return createDefaultLandingContent();
  }
}

async function loadLandingContentImpl(): Promise<{
  content: LandingContent;
  updatedAt: string | null;
  updatedByEmail: string | null;
  source: "db" | "default";
}> {
  try {
    const result = await dbQuery<LandingContentDocumentRow>(
      `select d.content, d.updated_at, u.email as updated_by_email
         from admin_documents d
         left join users u on u.id = d.updated_by
        where d.key = $1
        limit 1`,
      [LANDING_CONTENT_DOCUMENT_KEY],
    );
    const row = result.rows[0] ?? null;
    if (!row?.content) {
      return {
        content: createDefaultLandingContent(),
        updatedAt: null,
        updatedByEmail: null,
        source: "default",
      };
    }
    return {
      content: parseLandingContentDocument(row.content),
      updatedAt: row.updated_at ?? null,
      updatedByEmail: row.updated_by_email ?? null,
      source: "db",
    };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      return {
        content: createDefaultLandingContent(),
        updatedAt: null,
        updatedByEmail: null,
        source: "default",
      };
    }
    logError("landing-content.load", error, {});
    return {
      content: createDefaultLandingContent(),
      updatedAt: null,
      updatedByEmail: null,
      source: "default",
    };
  }
}

export const loadLandingContent = cache(loadLandingContentImpl);

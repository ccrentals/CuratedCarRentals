import { services } from "@/data/services";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@/lib/landingContent";
import type { PublicVehicle } from "@/lib/publicVehicles";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/seo";

const BUSINESS_ID = `${SITE_URL}/#business`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export function businessStructuredData(
  content: LandingContent["global"] = DEFAULT_LANDING_CONTENT.global,
) {
  return {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    "@id": BUSINESS_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/live-site/brand/logo.png"),
    image: absoluteUrl("/live-site/home/hero-tropical-car.jpg"),
    description: content.brandDescription,
    email: content.email,
    telephone: content.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: "166 Old Hope Road",
      addressLocality: "Kingston",
      addressCountry: "JM",
    },
    areaServed: {
      "@type": "Country",
      name: "Jamaica",
    },
    currenciesAccepted: "JMD",
    contactPoint: content.phones.map((phone) => ({
      "@type": "ContactPoint",
      telephone: phone.label.replace(/\s*\([^)]*\)\s*$/, ""),
      contactType: "customer service",
      areaServed: phone.label.includes("USA") ? ["US", "JM"] : "JM",
      availableLanguage: "English",
    })),
  };
}

export function websiteStructuredData(
  content: LandingContent["global"] = DEFAULT_LANDING_CONTENT.global,
) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    description: content.brandDescription,
    inLanguage: "en-JM",
    publisher: {
      "@id": BUSINESS_ID,
    },
  };
}

export function servicesStructuredData(serviceItems: LandingContent["services"]["items"] = services) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Curated Car Rentals services",
    itemListElement: serviceItems.map((service, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Service",
        name: service.title,
        description: service.description,
        url: absoluteUrl(`/services#${service.id}`),
        provider: {
          "@id": BUSINESS_ID,
        },
        areaServed: {
          "@type": "Country",
          name: "Jamaica",
        },
      },
    })),
  };
}

export function vehicleStructuredData(vehicle: PublicVehicle) {
  const path = `/fleet/${encodeURIComponent(vehicle.slug || vehicle.id)}`;
  const image = vehicle.images.find((item) => item !== "/window.svg");

  return {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: vehicle.name,
    url: absoluteUrl(path),
    ...(image ? { image: absoluteUrl(image) } : {}),
    description: vehicle.description,
    brand: {
      "@type": "Brand",
      name: vehicle.make,
    },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    vehicleConfiguration: vehicle.category,
    vehicleTransmission: vehicle.transmission,
    vehicleSeatingCapacity: vehicle.seats,
    numberOfDoors: vehicle.doors,
    offers: {
      "@type": "Offer",
      url: absoluteUrl(path),
      priceCurrency: "JMD",
      price: vehicle.daily_rate_cents.toFixed(2),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        priceCurrency: "JMD",
        price: vehicle.daily_rate_cents.toFixed(2),
        unitCode: "DAY",
      },
      seller: {
        "@id": BUSINESS_ID,
      },
    },
  };
}

export function breadcrumbStructuredData(
  items: Array<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqStructuredData(
  items: ReadonlyArray<{ question: string; answer: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

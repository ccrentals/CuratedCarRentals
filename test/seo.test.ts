import assert from "node:assert/strict";
import test from "node:test";

import robots from "@/app/robots";
import { rentalFaqs } from "@/data/content";
import {
  absoluteUrl,
  privatePageMetadata,
  publicPageMetadata,
  SITE_URL,
} from "@/lib/seo";
import {
  businessStructuredData,
  faqStructuredData,
  servicesStructuredData,
  vehicleStructuredData,
} from "@/lib/structuredData";

test("public metadata includes a canonical URL and social previews", () => {
  const metadata = publicPageMetadata({
    title: "Fleet",
    description: "Browse rental vehicles.",
    path: "/fleet",
  });

  assert.equal(metadata.alternates?.canonical, `${SITE_URL}/fleet`);
  assert.equal(metadata.openGraph && "url" in metadata.openGraph ? metadata.openGraph.url : null, `${SITE_URL}/fleet`);
  assert.equal(metadata.twitter && "card" in metadata.twitter ? metadata.twitter.card : null, "summary_large_image");
});

test("private metadata prevents indexing and following", () => {
  assert.equal(privatePageMetadata.robots && "index" in privatePageMetadata.robots ? privatePageMetadata.robots.index : null, false);
  assert.equal(privatePageMetadata.robots && "follow" in privatePageMetadata.robots ? privatePageMetadata.robots.follow : null, false);
});

test("robots allows public crawling while excluding private workflows", () => {
  const config = robots();
  const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
  const defaultRule = rules.find((rule) => rule.userAgent === "*");
  const openAiRule = rules.find((rule) => rule.userAgent === "OAI-SearchBot");

  assert.ok(defaultRule);
  assert.ok(openAiRule);
  assert.ok(Array.isArray(defaultRule.disallow));
  assert.ok(defaultRule.disallow.includes("/admin/"));
  assert.ok(defaultRule.disallow.includes("/bookings/"));
  assert.equal(config.sitemap, `${SITE_URL}/sitemap.xml`);
});

test("business and service structured data use supported public facts", () => {
  const business = businessStructuredData();
  const serviceList = servicesStructuredData();

  assert.equal(business["@type"], "AutoRental");
  assert.equal(business.url, SITE_URL);
  assert.equal(
    (business.address as { addressLocality: string }).addressLocality,
    "Kingston",
  );
  assert.equal(serviceList["@type"], "ItemList");
  assert.ok(serviceList.itemListElement.length >= 5);
});

test("FAQ structured data mirrors the visible rental FAQ content", () => {
  const faq = faqStructuredData(rentalFaqs);

  assert.equal(faq["@type"], "FAQPage");
  assert.equal(faq.mainEntity.length, rentalFaqs.length);
  assert.equal(faq.mainEntity[0].name, rentalFaqs[0].question);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, rentalFaqs[0].answer);
  assert.equal(absoluteUrl("/contact"), `${SITE_URL}/contact`);
});

test("vehicle structured data preserves the repository's whole-JMD rate convention", () => {
  const vehicle = vehicleStructuredData({
    id: "vehicle-1",
    slug: "toyota-aqua",
    name: "Toyota Aqua",
    make: "Toyota",
    model: "Aqua",
    year: 2019,
    category: "Economy",
    description: "Economy rental vehicle.",
    transmission: "Automatic",
    seats: 5,
    bags: 2,
    doors: 4,
    daily_rate_cents: 7200,
    deposit_cents: 2500,
    pricePerDay: 7200,
    images: ["/cars/real/toyota-yaris-2020-1.jpg"],
    featured: false,
    security_deposit_jmd: null,
    status: "AVAILABLE",
    legacyId: null,
    fuelPolicy: "Full to Full",
    mileagePolicy: "Unlimited",
    airConditioning: true,
    hybrid: false,
    drivetrain: "",
  });

  assert.equal((vehicle.offers as { price: string }).price, "7200.00");
});

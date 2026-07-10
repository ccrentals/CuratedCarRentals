import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyLandingItem,
  getLandingAddItemConfig,
  LANDING_ADD_ITEM_COLLECTION_PATHS,
  orderLandingItemFields,
  validateLandingItem,
} from "@/lib/landingContentEditor";

test("add item configuration identifies collection-specific workflows", () => {
  assert.equal(getLandingAddItemConfig(["global", "phones"]).title, "Add phone number");
  assert.equal(getLandingAddItemConfig(["home", "testimonials"]).title, "Add testimonial");
  assert.equal(getLandingAddItemConfig(["services", "items"]).title, "Add service");
  assert.equal(getLandingAddItemConfig(["rentalPolicies", "faqs"]).title, "Add frequently asked question");
});

test("every current repeatable landing collection has a dedicated popup configuration", () => {
  assert.deepEqual([...LANDING_ADD_ITEM_COLLECTION_PATHS].sort(), [
    "about.features",
    "about.mission",
    "contact.beforeYouSendParagraphs",
    "contact.reassuranceItems",
    "driving.tips",
    "global.addressLines",
    "global.footerLegalLinks",
    "global.footerQuickLinks",
    "global.navigation",
    "global.phones",
    "global.socialLinks",
    "global.whatsapps",
    "home.aboutFeatures",
    "home.testimonials",
    "rentalPolicies.deposit",
    "rentalPolicies.faqs",
    "rentalPolicies.paidItems",
    "rentalPolicies.requirements",
    "rentalPolicies.unpaidItems",
    "services.items",
    "touristDestinations.items",
  ]);
});

test("new items start empty instead of cloning published content", () => {
  assert.deepEqual(
    createEmptyLandingItem({ label: "Existing", href: "/existing", icon: "youtube" }),
    { label: "", href: "", icon: "facebook" },
  );
  assert.equal(createEmptyLandingItem("Existing paragraph"), "");
});

test("collection field order presents the relevant choices in workflow order", () => {
  const socialConfig = getLandingAddItemConfig(["global", "socialLinks"]);
  assert.deepEqual(
    orderLandingItemFields(
      { href: "", label: "", icon: "facebook" },
      socialConfig.fieldOrder,
    ).map(([fieldName]) => fieldName),
    ["icon", "label", "href"],
  );
});

test("new item validation rejects incomplete, unsafe, and duplicate values", () => {
  const incomplete = validateLandingItem({ label: "", href: "javascript:alert(1)" }, []);
  assert.match(incomplete.label ?? "", /required/i);
  assert.match(incomplete.href ?? "", /internal path/i);

  const duplicate = validateLandingItem(
    { id: "airport-pickup", title: "Airport pickup" },
    [{ id: "airport-pickup", title: "Existing" }],
  );
  assert.match(duplicate.id ?? "", /already in use/i);
});

test("new item validation accepts supported links and Uploadcare images", () => {
  assert.deepEqual(
    validateLandingItem(
      {
        label: "+1 (876) 379-7163",
        href: "tel:+18763797163",
        imageSrc: "https://ucarecdn.com/00000000-0000-0000-0000-000000000000/",
      },
      [],
    ),
    {},
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAdminMediaItems,
  loadAdminMediaItems,
  type AdminMediaItem,
} from "@/lib/uploads/adminMedia";
import { canAccessAdminPath } from "@/lib/auth/adminCapabilities";

const FILE_ID = "11111111-1111-4111-8111-111111111111";

test("media library is restricted to privileged admin roles", () => {
  assert.equal(canAccessAdminPath("ADMIN", "/admin/media"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/media"), true);
  assert.equal(canAccessAdminPath("OPERATIONS", "/admin/media"), false);
  assert.equal(canAccessAdminPath(null, "/admin/media"), false);
});

test("admin media library maps inspection images and respects booking locks", async () => {
  const items = await loadAdminMediaItems("inspections", {
    query: async () => ({
      rows: [
        {
          id: "image-1",
          inspection_id: "inspection-1",
          booking_id: "booking-1",
          booking_public_id: "BK000101",
          booking_status: "BOOKED",
          inspection_type: "PICKUP",
          category: "EXTERIOR",
          label: null,
          generated_file_name: "BK000101-pickup-exterior.jpg",
          original_file_name: "photo.jpg",
          mime_type: "image/jpeg",
          uploaded_by_display: "Admin User",
          created_at: "2026-06-07T12:00:00.000Z",
          vehicle_id: "vehicle-1",
          vehicle_public_id: "VE000101",
          vehicle_make: "Toyota",
          vehicle_model: "Aqua",
          vehicle_year: 2019,
        },
        {
          id: "image-2",
          inspection_id: "inspection-2",
          booking_id: "booking-2",
          booking_public_id: "BK000102",
          booking_status: "RETURNED",
          inspection_type: "RETURN",
          category: "DAMAGE",
          label: "Rear bumper",
          generated_file_name: "BK000102-return-damage.jpg",
          original_file_name: "damage.jpg",
          mime_type: "image/jpeg",
          uploaded_by_display: null,
          created_at: "2026-06-06T12:00:00.000Z",
          vehicle_id: "vehicle-2",
          vehicle_public_id: "VE000102",
          vehicle_make: "Subaru",
          vehicle_model: "XV",
          vehicle_year: 2018,
        },
      ],
    }),
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].categoryLabel, "Exterior");
  assert.equal(items[0].vehicleLabel, "2019 Toyota Aqua");
  assert.equal(items[0].canRemove, true);
  assert.deepEqual(items[0].removePayload, {
    inspectionId: "inspection-1",
    inspectionType: "PICKUP",
  });
  assert.equal(items[1].canRemove, false);
  assert.equal(items[1].removeUrl, null);
});

test("admin media library maps vehicle gallery metadata and primary position", async () => {
  const items = await loadAdminMediaItems("vehicles", {
    query: async () => ({
      rows: [
        {
          id: "vehicle-1",
          public_id: "VE000101",
          make: "Toyota",
          model: "Aqua",
          year: 2019,
          status: "AVAILABLE",
          image_urls_json: [`https://ucarecdn.com/${FILE_ID}/`],
          features_json: {
            gallery_images: [
              {
                name: "VE000101-toyota-aqua-gallery-01",
                uploadcareFileId: FILE_ID,
                url: `https://ucarecdn.com/${FILE_ID}/`,
                position: 1,
                isPrimary: true,
              },
            ],
          },
          created_at: "2026-06-01T12:00:00.000Z",
          updated_at: "2026-06-07T12:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].fileName, "VE000101-toyota-aqua-gallery-01");
  assert.equal(items[0].category, "PRIMARY");
  assert.equal(items[0].isPrimary, true);
  assert.equal(items[0].canRemove, false);
});

test("admin media library includes only image vehicle files with existing archive action", async () => {
  const items = await loadAdminMediaItems("vehicle-files", {
    query: async () => ({
      rows: [
        {
          id: "document-1",
          vehicle_id: "vehicle-1",
          vehicle_public_id: "VE000101",
          vehicle_make: "Toyota",
          vehicle_model: "Aqua",
          vehicle_year: 2019,
          folder: "Maintenance",
          document_type: "SERVICE_PHOTO",
          title: "Oil service photo.jpg",
          label: "Oil service",
          mime_type: "image/jpeg",
          uploaded_by_display: "Admin User",
          created_at: "2026-06-07T12:00:00.000Z",
        },
        {
          id: "document-2",
          vehicle_id: "vehicle-1",
          vehicle_public_id: "VE000101",
          vehicle_make: "Toyota",
          vehicle_model: "Aqua",
          vehicle_year: 2019,
          folder: "Registration",
          document_type: "REGISTRATION",
          title: "Registration.pdf",
          label: null,
          mime_type: "application/pdf",
          uploaded_by_display: "Admin User",
          created_at: "2026-06-07T12:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].categoryLabel, "Maintenance");
  assert.equal(items[0].subtypeLabel, "SERVICE PHOTO");
  assert.equal(items[0].canRemove, true);
  assert.match(items[0].removeUrl ?? "", /documents\/document-1$/);
});

test("admin media library combines search, category, vehicle, dates, and sorting", () => {
  const base = {
    source: "inspections",
    sourceLabel: "Vehicle inspection",
    previewUrl: "/preview",
    openUrl: "/open",
    manageUrl: "/manage",
    bookingId: "booking-1",
    subtype: "PICKUP",
    subtypeLabel: "Pickup",
    uploadedBy: "Admin User",
    isPrimary: false,
    canRemove: false,
    removeUrl: null,
    removePayload: null,
  } satisfies Partial<AdminMediaItem>;
  const items: AdminMediaItem[] = [
    {
      ...base,
      id: "1",
      title: "Exterior",
      fileName: "BK000101-exterior.jpg",
      vehicleId: "vehicle-1",
      vehiclePublicId: "VE000101",
      vehicleLabel: "2019 Toyota Aqua",
      bookingPublicId: "BK000101",
      category: "EXTERIOR",
      categoryLabel: "Exterior",
      createdAt: "2026-06-07T12:00:00.000Z",
    } as AdminMediaItem,
    {
      ...base,
      id: "2",
      title: "Interior",
      fileName: "BK000102-interior.jpg",
      vehicleId: "vehicle-2",
      vehiclePublicId: "VE000102",
      vehicleLabel: "2018 Subaru XV",
      bookingPublicId: "BK000102",
      category: "INTERIOR",
      categoryLabel: "Interior",
      createdAt: "2026-06-06T12:00:00.000Z",
    } as AdminMediaItem,
  ];

  const filtered = filterAdminMediaItems(items, {
    query: "aqua",
    vehicleId: "vehicle-1",
    category: "EXTERIOR",
    subtype: "PICKUP",
    dateFrom: "2026-06-07",
    dateTo: "2026-06-07",
    sort: "oldest",
  });

  assert.deepEqual(filtered.map((item) => item.id), ["1"]);
});

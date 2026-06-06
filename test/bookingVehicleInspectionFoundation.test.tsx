import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  handleAdminBookingCompleteAction,
  handleAdminBookingPickupAction,
} from "@/app/api/admin/bookings/[id]/route";
import {
  handleAdminBookingInspectionsGet,
  handleAdminBookingInspectionsPut,
} from "@/app/api/admin/bookings/[id]/inspections/route";
import { handleAdminBookingInspectionImagesPost } from "@/app/api/admin/bookings/[id]/inspections/images/route";
import {
  handleAdminBookingInspectionImageDelete,
  handleAdminBookingInspectionImageGet,
} from "@/app/api/admin/bookings/[id]/inspections/images/[imageId]/route";
import { handleAdminBookingInspectionImagesArchivePost } from "@/app/api/admin/bookings/[id]/inspections/images/archive/route";
import { BookingVehicleInspectionPanel } from "@/components/admin/BookingVehicleInspectionPanel";
import type { RequireAdminApiSessionResult } from "@/lib/auth/adminGuards";
import { DEFAULT_ADMIN_SETTINGS } from "@/lib/adminSettings";
import {
  BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS,
  archiveEligibleBookingVehicleInspectionImages,
  createBookingVehicleInspectionImages,
  archiveBookingVehicleInspectionImage,
  buildBookingVehicleInspectionImageFileName,
  correctBookingVehicleInspectionOdometer,
  createEmptyBookingVehicleInspectionSummaries,
  evaluateBookingVehicleInspectionImageArchiveCandidates,
  formatBookingVehicleInspectionFuelLevel,
  getBookingVehicleInspectionIssueFlags,
  getBookingVehicleInspectionStatusLabel,
  loadBookingVehicleInspectionSummaries,
  processBookingVehicleInspectionIssues,
  type LoadedBookingVehicleInspections,
} from "@/lib/bookings/vehicleInspection";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";
const VEHICLE_ID = "22222222-2222-4222-8222-222222222222";
const PICKUP_INSPECTION_ID = "33333333-3333-4333-8333-333333333333";
const RETURN_INSPECTION_ID = "44444444-4444-4444-8444-444444444444";
const PICKUP_IMAGE_ID = "55555555-5555-4555-8555-555555555555";
const RETURN_IMAGE_ID = "66666666-6666-4666-8666-666666666666";

function authorizedStaffResult() {
  return {
    ok: true,
    actor: {
      userId: "admin-user-id",
      role: "ADMIN",
      appRole: "ADMIN",
      authSource: "legacy" as const,
      clerkUserId: null,
      issuedAt: 0,
      expiresAt: 0,
    },
    session: {
      userId: "admin-user-id",
      role: "ADMIN",
      issuedAt: 0,
      expiresAt: 0,
      source: "legacy" as const,
      clerkUserId: null,
    },
  };
}

function authorizedUserResult() {
  return {
    ok: true,
    actor: {
      userId: "staff-user-id",
      role: "USER",
      appRole: "USER" as const,
      authSource: "legacy" as const,
      clerkUserId: null,
      issuedAt: 0,
      expiresAt: 0,
    },
    session: {
      userId: "staff-user-id",
      role: "USER",
      issuedAt: 0,
      expiresAt: 0,
      source: "legacy" as const,
      clerkUserId: null,
    },
  };
}

function sampleInspectionSet(
  overrides: Partial<LoadedBookingVehicleInspections> = {},
): LoadedBookingVehicleInspections {
  return {
    bookingId: BOOKING_ID,
    bookingPublicId: "BK000334",
    vehicleId: VEHICLE_ID,
    vehicleOdometerValue: 45200,
    vehicleOdometerUnit: "KM",
    pickup: {
      inspectionType: "PICKUP",
      inspectionId: PICKUP_INSPECTION_ID,
      recordStatus: "DRAFT",
      displayStatus: "IN_PROGRESS",
      displayStatusLabel: "In progress",
      odometerValue: 45231,
      odometerUnit: "KM",
      fuelLevelEighths: 6,
      fuelLevelDisplay: "75%",
      damagePresent: false,
      damageDisplay: "No",
      notes: "Minor dust on exterior.",
      noteSnippet: "Minor dust on exterior.",
      imageCount: 2,
      images: [
        {
          id: PICKUP_IMAGE_ID,
          inspectionId: PICKUP_INSPECTION_ID,
          inspectionType: "PICKUP",
          category: "ODOMETER",
          categoryLabel: "Odometer",
          label: null,
          storageProvider: "UPLOADCARE_FILE_ID",
          generatedFileName: "BK000334-pickup-odometer-20260315T120000Z-01.jpg",
          originalFileName: null,
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          previewUrl: "https://ucarecdn.com/pickup-image/",
          downloadUrl: "https://ucarecdn.com/pickup-image/",
          uploadedByUserId: "admin-user-id",
          uploadedByDisplay: "Admin User",
          createdAt: "2026-03-15T12:05:00.000Z",
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          inspectionId: PICKUP_INSPECTION_ID,
          inspectionType: "PICKUP",
          category: "EXTERIOR",
          categoryLabel: "Exterior",
          label: null,
          storageProvider: "UPLOADCARE_FILE_ID",
          generatedFileName: "BK000334-pickup-exterior-20260315T120100Z-02.jpg",
          originalFileName: null,
          mimeType: "image/jpeg",
          sizeBytes: 2048,
          previewUrl: "https://ucarecdn.com/pickup-image-2/",
          downloadUrl: "https://ucarecdn.com/pickup-image-2/",
          uploadedByUserId: "admin-user-id",
          uploadedByDisplay: "Admin User",
          createdAt: "2026-03-15T12:06:00.000Z",
        },
      ],
      recordedByUserId: "admin-user-id",
      recordedByDisplay: "Admin User",
      recordedAt: "2026-03-15T12:00:00.000Z",
      completedAt: null,
      createdAt: "2026-03-15T12:00:00.000Z",
      updatedAt: "2026-03-15T12:30:00.000Z",
      hasOdometerCorrection: false,
      odometerCorrectedFromValue: null,
      odometerCorrectionReason: null,
      odometerCorrectedByUserId: null,
      odometerCorrectedByDisplay: null,
      odometerCorrectedAt: null,
    },
    returnInspection: {
      inspectionType: "RETURN",
      inspectionId: RETURN_INSPECTION_ID,
      recordStatus: "COMPLETED",
      displayStatus: "COMPLETED",
      displayStatusLabel: "Completed",
      odometerValue: 45310,
      odometerUnit: "KM",
      fuelLevelEighths: 5,
      fuelLevelDisplay: "62.5%",
      damagePresent: true,
      damageDisplay: "Yes",
      notes: "Scratch noted on rear bumper.",
      noteSnippet: "Scratch noted on rear bumper.",
      imageCount: 3,
      images: [
        {
          id: RETURN_IMAGE_ID,
          inspectionId: RETURN_INSPECTION_ID,
          inspectionType: "RETURN",
          category: "DAMAGE",
          categoryLabel: "Damage",
          label: null,
          storageProvider: "UPLOADCARE_FILE_ID",
          generatedFileName: "BK000334-return-damage-20260317T140000Z-01.jpg",
          originalFileName: null,
          mimeType: "image/jpeg",
          sizeBytes: 3072,
          previewUrl: "https://ucarecdn.com/return-image/",
          downloadUrl: "https://ucarecdn.com/return-image/",
          uploadedByUserId: "admin-user-id",
          uploadedByDisplay: "Admin User",
          createdAt: "2026-03-17T13:30:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          inspectionId: RETURN_INSPECTION_ID,
          inspectionType: "RETURN",
          category: "FUEL_GAUGE",
          categoryLabel: "Fuel gauge",
          label: null,
          storageProvider: "UPLOADCARE_FILE_ID",
          generatedFileName: "BK000334-return-fuel-gauge-20260317T140100Z-02.jpg",
          originalFileName: null,
          mimeType: "image/jpeg",
          sizeBytes: 4096,
          previewUrl: "https://ucarecdn.com/return-image-2/",
          downloadUrl: "https://ucarecdn.com/return-image-2/",
          uploadedByUserId: "admin-user-id",
          uploadedByDisplay: "Admin User",
          createdAt: "2026-03-17T13:32:00.000Z",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          inspectionId: RETURN_INSPECTION_ID,
          inspectionType: "RETURN",
          category: "ODOMETER",
          categoryLabel: "Odometer",
          label: null,
          storageProvider: "UPLOADCARE_FILE_ID",
          generatedFileName: "BK000334-return-odometer-20260317T140200Z-03.jpg",
          originalFileName: null,
          mimeType: "image/jpeg",
          sizeBytes: 5120,
          previewUrl: "https://ucarecdn.com/return-image-3/",
          downloadUrl: "https://ucarecdn.com/return-image-3/",
          uploadedByUserId: "admin-user-id",
          uploadedByDisplay: "Admin User",
          createdAt: "2026-03-17T13:34:00.000Z",
        },
      ],
      recordedByUserId: "admin-user-id",
      recordedByDisplay: "Admin User",
      recordedAt: "2026-03-17T14:00:00.000Z",
      completedAt: "2026-03-17T14:00:00.000Z",
      createdAt: "2026-03-17T13:00:00.000Z",
      updatedAt: "2026-03-17T14:00:00.000Z",
      hasOdometerCorrection: false,
      odometerCorrectedFromValue: null,
      odometerCorrectionReason: null,
      odometerCorrectedByUserId: null,
      odometerCorrectedByDisplay: null,
      odometerCorrectedAt: null,
    },
    ...overrides,
  };
}

function sampleCompletedInspectionSet(
  overrides: Partial<LoadedBookingVehicleInspections> = {},
): LoadedBookingVehicleInspections {
  return sampleInspectionSet({
    pickup: {
      ...sampleInspectionSet().pickup,
      recordStatus: "COMPLETED",
      displayStatus: "COMPLETED",
      displayStatusLabel: "Completed",
      completedAt: "2026-03-15T12:30:00.000Z",
    },
    ...overrides,
  });
}

function cleanCompletedInspectionSet(
  overrides: Partial<LoadedBookingVehicleInspections> = {},
): LoadedBookingVehicleInspections {
  const base = sampleCompletedInspectionSet();
  return sampleCompletedInspectionSet({
    pickup: {
      ...base.pickup,
      recordStatus: "COMPLETED",
      displayStatus: "COMPLETED",
      displayStatusLabel: "Completed",
      damagePresent: false,
      damageDisplay: "No",
      fuelLevelEighths: 6,
      fuelLevelDisplay: "75%",
    },
    returnInspection: {
      ...base.returnInspection,
      damagePresent: false,
      damageDisplay: "No",
      fuelLevelEighths: 6,
      fuelLevelDisplay: "75%",
    },
    ...overrides,
  });
}

test("booking vehicle inspection helpers: derive display labels and fuel labels", () => {
  assert.equal(getBookingVehicleInspectionStatusLabel(null), "Not started");
  assert.equal(getBookingVehicleInspectionStatusLabel("DRAFT"), "In progress");
  assert.equal(getBookingVehicleInspectionStatusLabel("COMPLETED"), "Completed");
  assert.equal(formatBookingVehicleInspectionFuelLevel(0), "0%");
  assert.equal(formatBookingVehicleInspectionFuelLevel(7), "87.5%");
  assert.equal(formatBookingVehicleInspectionFuelLevel(null), "Not recorded");
});

test("booking vehicle inspection helper: detects fuel mismatch and return damage warnings", () => {
  const result = getBookingVehicleInspectionIssueFlags(sampleCompletedInspectionSet());

  assert.equal(result.hasFuelMismatch, true);
  assert.equal(result.hasReturnDamage, true);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.warnings[0]?.code, "FUEL_MISMATCH");
  assert.equal(result.warnings[1]?.code, "RETURN_DAMAGE");
});

test("booking vehicle inspection helper: does not create warnings for normal values", () => {
  const result = getBookingVehicleInspectionIssueFlags(
    sampleInspectionSet({
      pickup: {
        ...sampleInspectionSet().pickup,
        recordStatus: "COMPLETED",
        displayStatus: "COMPLETED",
        displayStatusLabel: "Completed",
      },
      returnInspection: {
        ...sampleInspectionSet().returnInspection,
        fuelLevelEighths: 6,
        fuelLevelDisplay: "75%",
        damagePresent: false,
        damageDisplay: "No",
      },
    }),
  );

  assert.equal(result.hasFuelMismatch, false);
  assert.equal(result.hasReturnDamage, false);
  assert.equal(result.warnings.length, 0);
});

test("booking vehicle inspection helper: image filename includes booking id and inspection context", () => {
  const fileName = buildBookingVehicleInspectionImageFileName({
    bookingPublicId: "BK000334",
    inspectionType: "PICKUP",
    category: "odometer",
    capturedAt: "2026-03-15T13:45:12.000Z",
    index: 1,
    extension: "png",
  });

  assert.match(fileName, /^BK000334-pickup-odometer-20260315T134512Z-01\.png$/);
});

test("booking vehicle inspection image helper: stores upload metadata with booking context", async () => {
  const inserts: Array<unknown[]> = [];

  const created = await createBookingVehicleInspectionImages(
    BOOKING_ID,
    {
      inspectionId: PICKUP_INSPECTION_ID,
      inspectionType: "PICKUP",
      category: "ODOMETER",
      uploadedByUserId: "admin-user-id",
      files: [
        {
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "https://ucarecdn.com/f5a4c5f0-1234-4d1d-9ef5-000000000111/",
          mimeType: "image/png",
        },
      ],
    },
    {
      query: async <T = unknown>(text: string, params: unknown[] = []) => {
        if (text.includes("from bookings b") && text.includes("join booking_vehicle_inspections i")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                inspection_id: PICKUP_INSPECTION_ID,
                inspection_type: "PICKUP",
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("select max(sort_order)::int")) {
          return {
            rows: [{ max_sort_order: 0 }] as T[],
            rowCount: 1,
          };
        }

        if (text.startsWith("insert into booking_vehicle_inspection_images")) {
          inserts.push(params);
          return {
            rows: [
              {
                id: PICKUP_IMAGE_ID,
                inspection_id: PICKUP_INSPECTION_ID,
                booking_id: BOOKING_ID,
                inspection_type: "PICKUP",
                category: "ODOMETER",
                label: null,
                storage_provider: "UPLOADCARE_FILE_ID",
                storage_key: "https://ucarecdn.com/f5a4c5f0-1234-4d1d-9ef5-000000000111/",
                original_file_name: null,
                generated_file_name: "BK000334-pickup-odometer-20260315T134512Z-02.png",
                mime_type: "image/png",
                byte_size: null,
                uploaded_by_user_id: "admin-user-id",
                uploaded_by_display: null,
                created_at: "2026-03-15T13:45:12.000Z",
              },
            ] as T[],
            rowCount: 1,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
  );

  assert.equal(created.length, 1);
  assert.equal(created[0]?.category, "ODOMETER");
  assert.match(created[0]?.generatedFileName ?? "", /^BK000334-pickup-odometer-/);
  assert.equal(
    created[0]?.previewUrl,
    `/api/admin/bookings/${BOOKING_ID}/inspections/images/${PICKUP_IMAGE_ID}`,
  );
  const metadata = inserts[0]?.[12] as Record<string, unknown>;
  assert.equal(metadata.bookingPublicId, "BK000334");
  assert.equal(metadata.inspectionType, "PICKUP");
  assert.equal(metadata.category, "ODOMETER");
  assert.equal(
    inserts[0]?.[6],
    "https://ucarecdn.com/f5a4c5f0-1234-4d1d-9ef5-000000000111/",
  );
});

test("booking vehicle inspection image helper: rejects external URLs that only mimic Uploadcare refs", async () => {
  await assert.rejects(
    () =>
      createBookingVehicleInspectionImages(
        BOOKING_ID,
        {
          inspectionId: PICKUP_INSPECTION_ID,
          inspectionType: "PICKUP",
          category: "ODOMETER",
          uploadedByUserId: "admin-user-id",
          files: [
            {
              storageProvider: "UPLOADCARE_FILE_ID",
              storageKey: "https://attacker.example/f5a4c5f0-1234-4d1d-9ef5-000000000111/",
              mimeType: "image/png",
            },
          ],
        },
        {
          query: async <T = unknown>(text: string) => {
            if (text.includes("from bookings b") && text.includes("join booking_vehicle_inspections i")) {
              return {
                rows: [
                  {
                    booking_id: BOOKING_ID,
                    booking_public_id: "BK000334",
                    inspection_id: PICKUP_INSPECTION_ID,
                    inspection_type: "PICKUP",
                  },
                ] as T[],
                rowCount: 1,
              };
            }

            if (text.includes("select max(sort_order)::int")) {
              return {
                rows: [{ max_sort_order: 0 }] as T[],
                rowCount: 1,
              };
            }

            throw new Error(`Unexpected query: ${text}`);
          },
        },
      ),
    /INVALID_IMAGE_STORAGE_REFERENCE/,
  );
});

test("booking vehicle inspection image helper: archives inspection images", async () => {
  const archived = await archiveBookingVehicleInspectionImage(
    BOOKING_ID,
    {
      imageId: PICKUP_IMAGE_ID,
      inspectionId: PICKUP_INSPECTION_ID,
      inspectionType: "PICKUP",
    },
    {
      query: async <T = unknown>(text: string, params: unknown[] = []) => {
        assert.match(text, /update booking_vehicle_inspection_images/);
        assert.deepEqual(params, [PICKUP_IMAGE_ID, BOOKING_ID, PICKUP_INSPECTION_ID, "PICKUP"]);
        return {
          rows: [{ id: PICKUP_IMAGE_ID }] as T[],
          rowCount: 1,
        };
      },
    },
  );

  assert.equal(archived, true);
});

test("booking vehicle inspection archive helper: marks clean completed images eligible", async () => {
  const now = new Date("2026-03-15T12:00:00.000Z");
  const evaluation = await evaluateBookingVehicleInspectionImageArchiveCandidates(
    BOOKING_ID,
    {},
    {
      now,
      loadInspections: async () => cleanCompletedInspectionSet(),
      query: async <T = unknown>(text: string) => {
        if (text.includes("refund_like_payment_count")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                vehicle_id: VEHICLE_ID,
                booking_status: "RETURNED",
                booking_end_date: "2025-03-10",
                booking_created_at: "2025-03-01T10:00:00.000Z",
                pricing_json: { payment_status: "PAID_IN_FULL", refund_required: false },
                refund_like_payment_count: 0,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("img.id as image_id")) {
          return {
            rows: [
              {
                image_id: PICKUP_IMAGE_ID,
                inspection_id: PICKUP_INSPECTION_ID,
                inspection_type: "PICKUP",
                category: "ODOMETER",
                generated_file_name: "BK000334-pickup-odometer-20250310T120000Z-01.jpg",
                original_file_name: null,
                created_at: "2025-03-10T12:00:00.000Z",
                archived_at: null,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
  );

  assert.equal(evaluation?.policy.minimumAgeDays, BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS);
  assert.equal(evaluation?.policy.bookingCompleted, true);
  assert.equal(evaluation?.policy.bookingOldEnough, true);
  assert.equal(evaluation?.eligibleCount, 1);
  assert.equal(evaluation?.ineligibleCount, 0);
  assert.equal(evaluation?.candidates[0]?.eligible, true);
  assert.deepEqual(evaluation?.candidates[0]?.reasons, []);
});

test("booking vehicle inspection archive helper: rejects sensitive or incomplete cases", async () => {
  const now = new Date("2026-03-15T12:00:00.000Z");
  const evaluation = await evaluateBookingVehicleInspectionImageArchiveCandidates(
    BOOKING_ID,
    { imageIds: [PICKUP_IMAGE_ID, RETURN_IMAGE_ID] },
    {
      now,
      loadInspections: async () =>
        sampleInspectionSet({
          pickup: {
            ...sampleInspectionSet().pickup,
            recordStatus: "DRAFT",
            displayStatus: "IN_PROGRESS",
            displayStatusLabel: "In progress",
          },
          returnInspection: {
            ...sampleInspectionSet().returnInspection,
            recordStatus: "DRAFT",
            displayStatus: "IN_PROGRESS",
            displayStatusLabel: "In progress",
            completedAt: null,
          },
        }),
      query: async <T = unknown>(text: string) => {
        if (text.includes("refund_like_payment_count")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                vehicle_id: VEHICLE_ID,
                booking_status: "RETURNED",
                booking_end_date: "2026-03-10",
                booking_created_at: "2026-03-01T10:00:00.000Z",
                pricing_json: { payment_status: "REFUNDED", refund_required: true },
                refund_like_payment_count: 1,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("img.id as image_id")) {
          return {
            rows: [
              {
                image_id: PICKUP_IMAGE_ID,
                inspection_id: PICKUP_INSPECTION_ID,
                inspection_type: "PICKUP",
                category: "ODOMETER",
                generated_file_name: "BK000334-pickup-odometer-20260310T120000Z-01.jpg",
                original_file_name: null,
                created_at: "2026-03-10T12:00:00.000Z",
                archived_at: "2026-03-11T09:00:00.000Z",
              },
              {
                image_id: RETURN_IMAGE_ID,
                inspection_id: RETURN_INSPECTION_ID,
                inspection_type: "RETURN",
                category: "DAMAGE",
                generated_file_name: "BK000334-return-damage-20260310T120500Z-02.jpg",
                original_file_name: null,
                created_at: "2026-03-10T12:05:00.000Z",
                archived_at: null,
              },
            ] as T[],
            rowCount: 2,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
  );

  assert.equal(evaluation?.eligibleCount, 0);
  assert.equal(evaluation?.ineligibleCount, 2);
  assert.deepEqual(evaluation?.candidates[0]?.reasons, [
    "ALREADY_ARCHIVED",
    "BOOKING_TOO_RECENT",
    "PICKUP_INSPECTION_INCOMPLETE",
    "RETURN_INSPECTION_INCOMPLETE",
    "REFUND_OR_REVIEW_PRESENT",
  ]);
  assert.deepEqual(evaluation?.candidates[1]?.reasons, [
    "BOOKING_TOO_RECENT",
    "PICKUP_INSPECTION_INCOMPLETE",
    "RETURN_INSPECTION_INCOMPLETE",
    "REFUND_OR_REVIEW_PRESENT",
    "DAMAGE_CATEGORY_PRESERVED",
  ]);
});

test("booking vehicle inspection archive helper: rejects completed warning cases", async () => {
  const evaluation = await evaluateBookingVehicleInspectionImageArchiveCandidates(
    BOOKING_ID,
    {},
    {
      now: new Date("2026-03-15T12:00:00.000Z"),
      loadInspections: async () => sampleCompletedInspectionSet(),
      query: async <T = unknown>(text: string) => {
        if (text.includes("refund_like_payment_count")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                vehicle_id: VEHICLE_ID,
                booking_status: "RETURNED",
                booking_end_date: "2025-03-10",
                booking_created_at: "2025-03-01T10:00:00.000Z",
                pricing_json: { payment_status: "PAID_IN_FULL", refund_required: false },
                refund_like_payment_count: 0,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("img.id as image_id")) {
          return {
            rows: [
              {
                image_id: RETURN_IMAGE_ID,
                inspection_id: RETURN_INSPECTION_ID,
                inspection_type: "RETURN",
                category: "ODOMETER",
                generated_file_name: "BK000334-return-odometer-20250310T120000Z-01.jpg",
                original_file_name: null,
                created_at: "2025-03-10T12:00:00.000Z",
                archived_at: null,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
  );

  assert.equal(evaluation?.eligibleCount, 0);
  assert.deepEqual(evaluation?.candidates[0]?.reasons, [
    "RETURN_DAMAGE_REPORTED",
    "FUEL_MISMATCH_PRESENT",
  ]);
});

test("booking vehicle inspection archive helper: archives eligible images and writes audit entries", async () => {
  const audits: Array<{
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }> = [];

  const result = await archiveEligibleBookingVehicleInspectionImages(
    BOOKING_ID,
    {
      archiveReason: "Phase 8 retention review",
      archiveSource: "test_batch",
      actorUserId: "admin-user-id",
    },
    {
      now: new Date("2026-03-15T12:00:00.000Z"),
      loadInspections: async () => cleanCompletedInspectionSet(),
      writeAudit: async (input) => {
        audits.push(input);
      },
      query: async <T = unknown>(text: string, params: unknown[] = []) => {
        if (text.includes("refund_like_payment_count")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                vehicle_id: VEHICLE_ID,
                booking_status: "RETURNED",
                booking_end_date: "2025-03-10",
                booking_created_at: "2025-03-01T10:00:00.000Z",
                pricing_json: { payment_status: "PAID_IN_FULL", refund_required: false },
                refund_like_payment_count: 0,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("img.id as image_id")) {
          return {
            rows: [
              {
                image_id: RETURN_IMAGE_ID,
                inspection_id: RETURN_INSPECTION_ID,
                inspection_type: "RETURN",
                category: "ODOMETER",
                generated_file_name: "BK000334-return-odometer-20250310T120000Z-01.jpg",
                original_file_name: null,
                created_at: "2025-03-10T12:00:00.000Z",
                archived_at: null,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("update booking_vehicle_inspection_images img")) {
          assert.deepEqual(params, [RETURN_IMAGE_ID, BOOKING_ID, RETURN_INSPECTION_ID, "RETURN"]);
          return {
            rows: [{ id: RETURN_IMAGE_ID }] as T[],
            rowCount: 1,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
  );

  assert.equal(result?.archivedCount, 1);
  assert.equal(result?.skippedCount, 0);
  assert.equal(result?.results[0]?.outcome, "ARCHIVED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVED");
  assert.equal(audits[0]?.entityType, "booking_vehicle_inspection_image");
  assert.equal(audits[0]?.entityId, RETURN_IMAGE_ID);
  assert.equal(audits[0]?.details?.archiveReason, "Phase 8 retention review");
  assert.equal(audits[0]?.details?.archiveSource, "test_batch");
});

test("booking vehicle inspection loader: returns not-started summaries when no inspections exist", async () => {
  const query = async <T = unknown>(text: string) => {
    if (text.includes("b.id as booking_id")) {
      return {
        rows: [
          {
            booking_id: BOOKING_ID,
            booking_public_id: "BK000334",
            vehicle_id: VEHICLE_ID,
            vehicle_odometer_value: 45200,
            vehicle_odometer_unit: "KM",
          },
        ] as T[],
        rowCount: 1,
      };
    }
    if (text.includes("from booking_vehicle_inspection_images img")) {
      return {
        rows: [] as T[],
        rowCount: 0,
      };
    }
    return {
      rows: [] as T[],
      rowCount: 0,
    };
  };

  const inspections = await loadBookingVehicleInspectionSummaries(BOOKING_ID, { query });

  assert.equal(inspections?.pickup.displayStatusLabel, "Not started");
  assert.equal(inspections?.returnInspection.displayStatusLabel, "Not started");
  assert.equal(inspections?.pickup.imageCount, 0);
  assert.equal(inspections?.returnInspection.imageCount, 0);
  assert.equal(inspections?.vehicleOdometerValue, 45200);
  assert.equal(inspections?.vehicleOdometerUnit, "KM");
});

test("booking vehicle inspection loader: maps draft and completed inspections into summary cards", async () => {
  const query = async <T = unknown>(text: string) => {
    if (text.includes("b.id as booking_id")) {
      return {
        rows: [
          {
            booking_id: BOOKING_ID,
            booking_public_id: "BK000334",
            vehicle_id: VEHICLE_ID,
            vehicle_odometer_value: 45200,
            vehicle_odometer_unit: "KM",
          },
        ] as T[],
        rowCount: 1,
      };
    }
    if (text.includes("from booking_vehicle_inspection_images img")) {
      return {
        rows: [
          {
            id: PICKUP_IMAGE_ID,
            inspection_id: PICKUP_INSPECTION_ID,
            booking_id: BOOKING_ID,
            inspection_type: "PICKUP",
            category: "ODOMETER",
            label: null,
            storage_provider: "UPLOADCARE_FILE_ID",
            storage_key: "f5a4c5f0-1234-4d1d-9ef5-000000000001",
            original_file_name: null,
            generated_file_name: "BK000334-pickup-odometer-20260315T120000Z-01.jpg",
            mime_type: "image/jpeg",
            byte_size: 1024,
            uploaded_by_user_id: "admin-user-id",
            uploaded_by_display: "Admin User",
            created_at: "2026-03-15T12:05:00.000Z",
          },
          {
            id: RETURN_IMAGE_ID,
            inspection_id: RETURN_INSPECTION_ID,
            booking_id: BOOKING_ID,
            inspection_type: "RETURN",
            category: "DAMAGE",
            label: null,
            storage_provider: "UPLOADCARE_FILE_ID",
            storage_key: "f5a4c5f0-1234-4d1d-9ef5-000000000002",
            original_file_name: null,
            generated_file_name: "BK000334-return-damage-20260317T140000Z-01.jpg",
            mime_type: "image/jpeg",
            byte_size: 2048,
            uploaded_by_user_id: "admin-user-id",
            uploaded_by_display: "Admin User",
            created_at: "2026-03-17T13:30:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            inspection_id: RETURN_INSPECTION_ID,
            booking_id: BOOKING_ID,
            inspection_type: "RETURN",
            category: "ODOMETER",
            label: null,
            storage_provider: "UPLOADCARE_FILE_ID",
            storage_key: "f5a4c5f0-1234-4d1d-9ef5-000000000003",
            original_file_name: null,
            generated_file_name: "BK000334-return-odometer-20260317T140100Z-02.jpg",
            mime_type: "image/jpeg",
            byte_size: 3072,
            uploaded_by_user_id: "admin-user-id",
            uploaded_by_display: "Admin User",
            created_at: "2026-03-17T13:34:00.000Z",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            inspection_id: RETURN_INSPECTION_ID,
            booking_id: BOOKING_ID,
            inspection_type: "RETURN",
            category: "FUEL_GAUGE",
            label: null,
            storage_provider: "UPLOADCARE_FILE_ID",
            storage_key: "f5a4c5f0-1234-4d1d-9ef5-000000000004",
            original_file_name: null,
            generated_file_name: "BK000334-return-fuel-gauge-20260317T140200Z-03.jpg",
            mime_type: "image/jpeg",
            byte_size: 4096,
            uploaded_by_user_id: "admin-user-id",
            uploaded_by_display: "Admin User",
            created_at: "2026-03-17T13:36:00.000Z",
          },
        ] as T[],
        rowCount: 4,
      };
    }
    return {
      rows: [
        {
          id: PICKUP_INSPECTION_ID,
          booking_id: BOOKING_ID,
          vehicle_id: VEHICLE_ID,
          inspection_type: "PICKUP",
          status: "DRAFT",
          odometer_value: 45231,
          odometer_unit: "KM",
          fuel_level_eighths: 6,
          damage_present: false,
          notes: "Minor dust on exterior.",
          recorded_by_user_id: "admin-user-id",
          recorded_by_display: "Admin User",
          completed_at: null,
          created_at: "2026-03-15T12:00:00.000Z",
          updated_at: "2026-03-15T12:30:00.000Z",
          image_count: 2,
        },
        {
          id: RETURN_INSPECTION_ID,
          booking_id: BOOKING_ID,
          vehicle_id: VEHICLE_ID,
          inspection_type: "RETURN",
          status: "COMPLETED",
          odometer_value: 45310,
          odometer_unit: "KM",
          fuel_level_eighths: 5,
          damage_present: true,
          notes: "Scratch noted on rear bumper.",
          recorded_by_user_id: "admin-user-id",
          recorded_by_display: "Admin User",
          completed_at: "2026-03-17T14:00:00.000Z",
          created_at: "2026-03-17T13:00:00.000Z",
          updated_at: "2026-03-17T14:00:00.000Z",
          image_count: 3,
        },
      ] as T[],
      rowCount: 2,
    };
  };

  const inspections = await loadBookingVehicleInspectionSummaries(BOOKING_ID, { query });

  assert.equal(inspections?.pickup.displayStatusLabel, "In progress");
  assert.equal(inspections?.pickup.fuelLevelDisplay, "75%");
  assert.equal(inspections?.pickup.images.length, 1);
  assert.equal(inspections?.returnInspection.displayStatusLabel, "Completed");
  assert.equal(inspections?.returnInspection.damageDisplay, "Yes");
  assert.equal(inspections?.returnInspection.imageCount, 3);
  assert.equal(inspections?.returnInspection.images[0]?.category, "DAMAGE");
});

test("booking vehicle inspection issue processing: creates admin notifications and audit logs", async () => {
  const messages: Array<{ recipientEmail: string; message: string }> = [];
  const audits: Array<{ action: string; details?: Record<string, unknown> }> = [];
  const duplicateChecks: string[] = [];

  const result = await processBookingVehicleInspectionIssues(
    BOOKING_ID,
    sampleCompletedInspectionSet(),
    {
      actorUserId: "admin-user-id",
      loadSettings: async () => ({
        settings: {
          ...DEFAULT_ADMIN_SETTINGS,
          sendVehicleInspectionWarningEmails: false,
        },
        source: "db" as const,
      }),
      resolveOperationalRouting: async () => ({
        configuredRecipients: [],
        effectiveRecipients: [],
        recipients: [],
        hasConfiguredRecipients: false,
        usesFallback: false,
        warnings: [],
      }),
      query: async <T = unknown>(text: string, params?: unknown[]) => {
        if (text.includes("from bookings b")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                customer_name: "Damian Thompson",
                customer_email: "damian.ay.thompson@gmail.com",
                vehicle_make: "Honda",
                vehicle_model: "Fit",
                vehicle_year: 2020,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("from audit_logs")) {
          duplicateChecks.push(String(params?.[0] ?? ""));
          return { rows: [] as T[], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
      insertAdminNotification: async (input) => {
        messages.push(input);
        return { id: `message-${messages.length}` };
      },
      writeAudit: async (input) => {
        audits.push({ action: input.action, details: input.details });
      },
    },
  );

  assert.equal(result.fuelMismatchCreated, true);
  assert.equal(result.returnDamageCreated, true);
  assert.equal(messages.length, 2);
  assert.deepEqual(duplicateChecks, [
    "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED",
    "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED",
  ]);
  assert.match(messages[0]?.message ?? "", /Return fuel is lower than pickup fuel/i);
  assert.match(messages[1]?.message ?? "", /Return inspection reports damage/i);
  assert.equal(audits.length, 2);
  assert.equal(audits[0]?.action, "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED");
  assert.equal(audits[1]?.action, "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED");
});

test("booking vehicle inspection issue processing: skips duplicate alerts", async () => {
  let auditChecks = 0;
  let insertedCount = 0;
  let auditWrites = 0;

  const result = await processBookingVehicleInspectionIssues(
    BOOKING_ID,
    sampleCompletedInspectionSet(),
    {
      loadSettings: async () => ({
        settings: {
          ...DEFAULT_ADMIN_SETTINGS,
          sendVehicleInspectionWarningEmails: false,
        },
        source: "db" as const,
      }),
      resolveOperationalRouting: async () => ({
        configuredRecipients: [],
        effectiveRecipients: [],
        recipients: [],
        hasConfiguredRecipients: false,
        usesFallback: false,
        warnings: [],
      }),
      query: async <T = unknown>(text: string, params?: unknown[]) => {
        void params;
        if (text.includes("from bookings b")) {
          return {
            rows: [
              {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                customer_name: "Damian Thompson",
                customer_email: "damian.ay.thompson@gmail.com",
                vehicle_make: "Honda",
                vehicle_model: "Fit",
                vehicle_year: 2020,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("from audit_logs")) {
          auditChecks += 1;
          return {
            rows: auditChecks === 1 ? ([{ id: "existing-audit" }] as T[]) : ([] as T[]),
            rowCount: auditChecks === 1 ? 1 : 0,
          };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
      insertAdminNotification: async () => {
        insertedCount += 1;
        return { id: `message-${insertedCount}` };
      },
      writeAudit: async () => {
        auditWrites += 1;
      },
    },
  );

  assert.equal(result.fuelMismatchCreated, false);
  assert.equal(result.returnDamageCreated, true);
  assert.equal(insertedCount, 1);
  assert.equal(auditWrites, 1);
});

test("booking vehicle inspection issue processing: does not create alerts when there are no issues", async () => {
  let insertedCount = 0;
  let auditWrites = 0;

  const result = await processBookingVehicleInspectionIssues(
    BOOKING_ID,
    sampleInspectionSet({
      pickup: {
        ...sampleInspectionSet().pickup,
        recordStatus: "COMPLETED",
        displayStatus: "COMPLETED",
        displayStatusLabel: "Completed",
      },
      returnInspection: {
        ...sampleInspectionSet().returnInspection,
        fuelLevelEighths: 6,
        fuelLevelDisplay: "75%",
        damagePresent: false,
        damageDisplay: "No",
      },
    }),
    {
      loadSettings: async () => ({
        settings: {
          ...DEFAULT_ADMIN_SETTINGS,
          sendVehicleInspectionWarningEmails: false,
        },
        source: "db" as const,
      }),
      insertAdminNotification: async () => {
        insertedCount += 1;
        return { id: "message-1" };
      },
      writeAudit: async () => {
        auditWrites += 1;
      },
    },
  );

  assert.equal(result.fuelMismatchCreated, false);
  assert.equal(result.returnDamageCreated, false);
  assert.equal(insertedCount, 0);
  assert.equal(auditWrites, 0);
});

test("booking vehicle inspection issue processing: sends outbound warning emails when routing is enabled", async () => {
  const sentEmails: Array<{ recipientEmails: string[]; subject: string }> = [];
  const dedupeAttempts: string[] = [];
  const dedupeResults: Array<{ dedupeKey: string; status: string }> = [];

  const result = await processBookingVehicleInspectionIssues(
    BOOKING_ID,
    sampleCompletedInspectionSet(),
    {
      loadSettings: async () => ({
        settings: {
          ...DEFAULT_ADMIN_SETTINGS,
          sendVehicleInspectionWarningEmails: true,
          defaultOperationalNotificationEmail: "ops@example.com",
          additionalOperationalNotificationEmails: ["fleet@example.com"],
        },
        source: "db" as const,
      }),
      resolveOperationalRouting: async () => ({
        configuredRecipients: ["ops@example.com", "fleet@example.com"],
        effectiveRecipients: ["ops@example.com", "fleet@example.com"],
        recipients: [
          {
            email: "ops@example.com",
            source: "configured-default",
            label: "Default operational email",
          },
          {
            email: "fleet@example.com",
            source: "configured-additional",
            label: "Additional operational recipient",
          },
        ],
        hasConfiguredRecipients: true,
        usesFallback: false,
        warnings: [],
      }),
      acquireDedupe: async (input) => {
        dedupeAttempts.push(input.eventType);
        return { ok: true, acquired: true };
      },
      recordDedupeResult: async (input) => {
        dedupeResults.push({ dedupeKey: input.dedupeKey, status: input.status });
      },
      sendWarningEmail: async (input) => {
        sentEmails.push(input);
        return { ok: true, providerMessageId: `provider-${sentEmails.length}` };
      },
    query: async <T = unknown>(text: string) => {
      if (text.includes("from bookings b")) {
        return {
          rows: [
            {
                booking_id: BOOKING_ID,
                booking_public_id: "BK000334",
                customer_name: "Damian Thompson",
                customer_email: "damian.ay.thompson@gmail.com",
                vehicle_make: "Honda",
                vehicle_model: "Fit",
                vehicle_year: 2020,
              },
            ] as T[],
            rowCount: 1,
          };
        }

        if (text.includes("from audit_logs")) {
          return { rows: [] as T[], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
      insertAdminNotification: async () => ({ id: "message-1" }),
      writeAudit: async () => {},
    },
  );

  assert.equal(result.fuelMismatchCreated, true);
  assert.equal(result.returnDamageCreated, true);
  assert.deepEqual(dedupeAttempts, [
    "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_EMAIL",
    "BOOKING_VEHICLE_INSPECTION_RETURN_DAMAGE_EMAIL",
  ]);
  assert.equal(sentEmails.length, 2);
  assert.deepEqual(sentEmails[0]?.recipientEmails, ["ops@example.com", "fleet@example.com"]);
  assert.match(sentEmails[0]?.subject ?? "", /Fuel mismatch/i);
  assert.match(sentEmails[1]?.subject ?? "", /Damage reported/i);
  assert.deepEqual(
    dedupeResults.map((entry) => entry.status),
    ["SENT", "SENT"],
  );
});

test("booking vehicle inspection issue processing: does not send outbound warning email when routing is disabled", async () => {
  let sendCalls = 0;

  await processBookingVehicleInspectionIssues(BOOKING_ID, sampleCompletedInspectionSet(), {
    loadSettings: async () => ({
      settings: {
        ...DEFAULT_ADMIN_SETTINGS,
        sendVehicleInspectionWarningEmails: false,
        defaultOperationalNotificationEmail: "ops@example.com",
      },
      source: "db" as const,
    }),
    resolveOperationalRouting: async () => ({
      configuredRecipients: ["ops@example.com"],
      effectiveRecipients: ["ops@example.com"],
      recipients: [
        {
          email: "ops@example.com",
          source: "configured-default",
          label: "Default operational email",
        },
      ],
      hasConfiguredRecipients: true,
      usesFallback: false,
      warnings: [],
    }),
    sendWarningEmail: async () => {
      sendCalls += 1;
      return { ok: true, providerMessageId: "provider-1" };
    },
    query: async <T = unknown>(text: string) => {
      if (text.includes("from bookings b")) {
        return {
          rows: [
            {
              booking_id: BOOKING_ID,
              booking_public_id: "BK000334",
              customer_name: "Damian Thompson",
              customer_email: "damian.ay.thompson@gmail.com",
              vehicle_make: "Honda",
              vehicle_model: "Fit",
              vehicle_year: 2020,
            },
          ] as T[],
          rowCount: 1,
        };
      }

      if (text.includes("from audit_logs")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    insertAdminNotification: async () => ({ id: "message-1" }),
    writeAudit: async () => {},
  });

  assert.equal(sendCalls, 0);
});

test("booking vehicle inspection issue processing: falls back to internal warnings when no email recipients resolve", async () => {
  let sendCalls = 0;
  let notificationCount = 0;
  let auditWrites = 0;

  const result = await processBookingVehicleInspectionIssues(BOOKING_ID, sampleCompletedInspectionSet(), {
    loadSettings: async () => ({
      settings: {
        ...DEFAULT_ADMIN_SETTINGS,
        sendVehicleInspectionWarningEmails: true,
        defaultOperationalNotificationEmail: "",
        additionalOperationalNotificationEmails: [],
      },
      source: "db" as const,
    }),
    resolveOperationalRouting: async () => ({
      configuredRecipients: [],
      effectiveRecipients: [],
      recipients: [],
      hasConfiguredRecipients: false,
      usesFallback: false,
      warnings: ["No valid operational notification recipients are configured."],
    }),
    sendWarningEmail: async () => {
      sendCalls += 1;
      return { ok: true, providerMessageId: "provider-1" };
    },
    query: async <T = unknown>(text: string) => {
      if (text.includes("from bookings b")) {
        return {
          rows: [
            {
              booking_id: BOOKING_ID,
              booking_public_id: "BK000334",
              customer_name: "Damian Thompson",
              customer_email: "damian.ay.thompson@gmail.com",
              vehicle_make: "Honda",
              vehicle_model: "Fit",
              vehicle_year: 2020,
            },
          ] as T[],
          rowCount: 1,
        };
      }

      if (text.includes("from audit_logs")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    insertAdminNotification: async () => {
      notificationCount += 1;
      return { id: `message-${notificationCount}` };
    },
    writeAudit: async () => {
      auditWrites += 1;
    },
  });

  assert.equal(result.fuelMismatchCreated, true);
  assert.equal(result.returnDamageCreated, true);
  assert.equal(sendCalls, 0);
  assert.equal(notificationCount, 2);
  assert.equal(auditWrites, 2);
});

test("booking vehicle inspection issue processing: skips duplicate outbound warning email sends", async () => {
  let sendCalls = 0;
  let dedupeCalls = 0;

  await processBookingVehicleInspectionIssues(BOOKING_ID, sampleCompletedInspectionSet(), {
    loadSettings: async () => ({
      settings: {
        ...DEFAULT_ADMIN_SETTINGS,
        sendVehicleInspectionWarningEmails: true,
        defaultOperationalNotificationEmail: "ops@example.com",
      },
      source: "db" as const,
    }),
    resolveOperationalRouting: async () => ({
      configuredRecipients: ["ops@example.com"],
      effectiveRecipients: ["ops@example.com"],
      recipients: [
        {
          email: "ops@example.com",
          source: "configured-default",
          label: "Default operational email",
        },
      ],
      hasConfiguredRecipients: true,
      usesFallback: false,
      warnings: [],
    }),
    acquireDedupe: async () => {
      dedupeCalls += 1;
      return { ok: false, acquired: false };
    },
    sendWarningEmail: async () => {
      sendCalls += 1;
      return { ok: true, providerMessageId: "provider-1" };
    },
    query: async <T = unknown>(text: string) => {
      if (text.includes("from bookings b")) {
        return {
          rows: [
            {
              booking_id: BOOKING_ID,
              booking_public_id: "BK000334",
              customer_name: "Damian Thompson",
              customer_email: "damian.ay.thompson@gmail.com",
              vehicle_make: "Honda",
              vehicle_model: "Fit",
              vehicle_year: 2020,
            },
          ] as T[],
          rowCount: 1,
        };
      }

      if (text.includes("from audit_logs")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    insertAdminNotification: async () => ({ id: "message-1" }),
    writeAudit: async () => {},
  });

  assert.equal(dedupeCalls, 2);
  assert.equal(sendCalls, 0);
});

test("booking vehicle inspection odometer correction: updates inspection and vehicle odometer", async () => {
  const executed: Array<{ text: string; params?: unknown[] }> = [];

  const result = await correctBookingVehicleInspectionOdometer(
    BOOKING_ID,
    {
      inspectionId: RETURN_INSPECTION_ID,
      inspectionType: "RETURN",
      correctedOdometerValue: 45280,
      correctionReason: "Dashboard typo on return intake.",
      correctedByUserId: "admin-user-id",
    },
    {
      runInTransaction: async (callback) =>
        callback(async <T = unknown>(text: string, params: unknown[] = []) => {
          executed.push({ text, params });
          if (text.includes("from booking_vehicle_inspections i")) {
            return {
              rows: [
                {
                  inspection_id: RETURN_INSPECTION_ID,
                  booking_id: BOOKING_ID,
                  booking_public_id: "BK000334",
                  vehicle_id: VEHICLE_ID,
                  inspection_type: "RETURN",
                  status: "COMPLETED",
                  odometer_value: 45310,
                  odometer_unit: "KM",
                  vehicle_odometer_value: 45310,
                  vehicle_odometer_unit: "KM",
                },
              ] as T[],
              rowCount: 1,
            };
          }

          if (
            text.includes("from booking_vehicle_inspections") &&
            text.includes("inspection_type = $2::text")
          ) {
            return {
              rows: [
                {
                  inspection_type: "PICKUP",
                  odometer_value: 45231,
                  odometer_unit: "KM",
                },
              ] as T[],
              rowCount: 1,
            };
          }

          return {
            rows: [] as T[],
            rowCount: 0,
          };
        }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.correction.previousOdometerValue, 45310);
  assert.equal(result.correction.correctedOdometerValue, 45280);
  assert.equal(result.correction.vehiclePreviousOdometerValue, 45310);
  assert.equal(result.correction.correctionReason, "Dashboard typo on return intake.");
  assert.ok(
    executed.some((entry) => entry.text.includes("update booking_vehicle_inspections")),
  );
  assert.ok(
    executed.some((entry) => entry.text.includes("insert into vehicle_profiles")),
  );
});

test("booking vehicle inspection odometer correction: blocks invalid pickup-return chronology", async () => {
  const result = await correctBookingVehicleInspectionOdometer(
    BOOKING_ID,
    {
      inspectionId: RETURN_INSPECTION_ID,
      inspectionType: "RETURN",
      correctedOdometerValue: 45200,
      correctionReason: "Attempted invalid rollback.",
      correctedByUserId: "admin-user-id",
    },
    {
      runInTransaction: async (callback) =>
        callback(async <T = unknown>(text: string) => {
          if (text.includes("from booking_vehicle_inspections i")) {
            return {
              rows: [
                {
                  inspection_id: RETURN_INSPECTION_ID,
                  booking_id: BOOKING_ID,
                  booking_public_id: "BK000334",
                  vehicle_id: VEHICLE_ID,
                  inspection_type: "RETURN",
                  status: "COMPLETED",
                  odometer_value: 45310,
                  odometer_unit: "KM",
                  vehicle_odometer_value: 45310,
                  vehicle_odometer_unit: "KM",
                },
              ] as T[],
              rowCount: 1,
            };
          }

          if (
            text.includes("from booking_vehicle_inspections") &&
            text.includes("inspection_type = $2::text")
          ) {
            return {
              rows: [
                {
                  inspection_type: "PICKUP",
                  odometer_value: 45231,
                  odometer_unit: "KM",
                },
              ] as T[],
              rowCount: 1,
            };
          }

          throw new Error(`Unexpected query: ${text}`);
        }),
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.match(result.error, /completed pickup odometer/i);
});

test("booking vehicle inspection route: GET requires auth", async () => {
  const response = await handleAdminBookingInspectionsGet(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () =>
        ({
          ok: false,
          reason: "unauthorized",
          response: new Response("Unauthorized", { status: 401 }),
        }) as RequireAdminApiSessionResult,
    },
  );

  assert.equal(response.status, 401);
});

test("booking vehicle inspection route: GET returns pickup and return summaries", async () => {
  const response = await handleAdminBookingInspectionsGet(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadInspections: async () => sampleInspectionSet(),
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    inspections?: {
      pickup?: { displayStatusLabel?: string };
      returnInspection?: { displayStatusLabel?: string; imageCount?: number };
    };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.inspections?.pickup?.displayStatusLabel, "In progress");
  assert.equal(payload.inspections?.returnInspection?.displayStatusLabel, "Completed");
  assert.equal(payload.inspections?.returnInspection?.imageCount, 3);
});

test("booking vehicle inspection image route: upload saves images with category and returns updated counts", async () => {
  const response = await handleAdminBookingInspectionImagesPost(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionId: PICKUP_INSPECTION_ID,
        inspectionType: "pickup",
        category: "odometer",
        files: [{ storageKey: "https://ucarecdn.com/f5a4c5f0-1234-4d1d-9ef5-000000001111/" }],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      validateUploads: async () => [
        {
          uuid: "f5a4c5f0-1234-4d1d-9ef5-000000001111",
          originalFileUrl:
            "https://project-files.ucarecd.net/f5a4c5f0-1234-4d1d-9ef5-000000001111/",
          size: 2048,
          mimeType: "image/jpeg",
          isImage: true,
          isReady: true,
          isStored: true,
          isRemoved: false,
          originalFilename: "inspection.jpg",
        },
      ],
      getBookingStatus: async () => "CONFIRMED",
      loadInspections: async () => sampleInspectionSet(),
      createImages: async (_bookingId, input) => {
        assert.equal(input.category, "ODOMETER");
        assert.equal(input.files.length, 1);
        assert.equal(
          input.files[0]?.storageKey,
          "https://project-files.ucarecd.net/f5a4c5f0-1234-4d1d-9ef5-000000001111/",
        );
        assert.equal(input.files[0]?.originalFileName, "inspection.jpg");
        assert.equal(input.files[0]?.mimeType, "image/jpeg");
        assert.equal(input.files[0]?.sizeBytes, 2048);
        return sampleInspectionSet().pickup.images.slice(0, 1);
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    createdImages?: Array<{ category?: string }>;
    inspections?: { pickup?: { imageCount?: number; images?: Array<unknown> } };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.createdImages?.[0]?.category, "ODOMETER");
  assert.equal(payload.inspections?.pickup?.imageCount, 2);
  assert.equal(payload.inspections?.pickup?.images?.length, 2);
});

test("booking vehicle inspection image route: locked inspections reject image changes", async () => {
  const response = await handleAdminBookingInspectionImagesPost(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionId: PICKUP_INSPECTION_ID,
        inspectionType: "pickup",
        category: "exterior",
        files: [{ storageKey: "https://ucarecdn.com/f5a4c5f0-1234-4d1d-9ef5-000000001112/" }],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      validateUploads: async () => [],
      getBookingStatus: async () => "PICKED_UP",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /locked after pickup is confirmed/i);
});

test("booking vehicle inspection image route: GET streams the verified Uploadcare file", async () => {
  const fileId = "f5a4c5f0-1234-4d1d-9ef5-000000001113";
  const response = await handleAdminBookingInspectionImageGet(
    new Request(
      `http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images/${PICKUP_IMAGE_ID}`,
    ),
    { params: Promise.resolve({ id: BOOKING_ID, imageId: PICKUP_IMAGE_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      getImage: async () => ({
        storageKey: `https://wrong-project.ucarecd.net/${fileId}/`,
        mimeType: "image/png",
        fileName: "pickup.png",
      }),
      getFileMetadata: async () => ({
        uuid: fileId,
        originalFileUrl: `https://correct-project.ucarecd.net/${fileId}/`,
        size: 7,
        mimeType: "image/png",
        isImage: true,
        isReady: true,
        isStored: true,
        isRemoved: false,
        originalFilename: "original.png",
      }),
      fetchFile: async (input) => {
        assert.equal(String(input), `https://correct-project.ucarecd.net/${fileId}/`);
        return new Response("PNGDATA", {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": "7",
          },
        });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.match(response.headers.get("Content-Disposition") ?? "", /pickup\.png/);
  assert.equal(await response.text(), "PNGDATA");
});

test("booking vehicle inspection image route: GET requires admin access", async () => {
  const response = await handleAdminBookingInspectionImageGet(
    new Request(
      `http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images/${PICKUP_IMAGE_ID}`,
    ),
    { params: Promise.resolve({ id: BOOKING_ID, imageId: PICKUP_IMAGE_ID }) },
    {
      requireAdminAccess: async () =>
        ({
          ok: false,
          reason: "unauthorized",
          response: new Response("Unauthorized", { status: 401 }),
        }) as RequireAdminApiSessionResult,
    },
  );

  assert.equal(response.status, 401);
});

test("booking vehicle inspection image route: delete archives image and returns updated summaries", async () => {
  const response = await handleAdminBookingInspectionImageDelete(
    new Request(
      `http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images/${PICKUP_IMAGE_ID}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionId: PICKUP_INSPECTION_ID,
          inspectionType: "pickup",
          csrfToken: "token",
        }),
      },
    ),
    { params: Promise.resolve({ id: BOOKING_ID, imageId: PICKUP_IMAGE_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
      loadInspections: async () =>
        sampleInspectionSet({
          pickup: {
            ...sampleInspectionSet().pickup,
            imageCount: 1,
            images: sampleInspectionSet().pickup.images.slice(0, 1),
          },
        }),
      archiveImage: async (_bookingId, input) => {
        assert.equal(input.imageId, PICKUP_IMAGE_ID);
        return true;
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    deletedImageId?: string;
    inspections?: { pickup?: { imageCount?: number } };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.deletedImageId, PICKUP_IMAGE_ID);
  assert.equal(payload.inspections?.pickup?.imageCount, 1);
});

test("booking vehicle inspection archive route: requires admin access", async () => {
  const response = await handleAdminBookingInspectionImagesArchivePost(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdmin: async () =>
        ({
          ok: false,
          reason: "forbidden",
          response: new Response("Forbidden", { status: 403 }),
        }) as RequireAdminApiSessionResult,
    },
  );

  assert.equal(response.status, 403);
});

test("booking vehicle inspection archive route: archives eligible images and returns updated active counts", async () => {
  const response = await handleAdminBookingInspectionImagesArchivePost(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections/images/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archiveReason: "Retention cleanup",
        imageIds: [RETURN_IMAGE_ID],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdmin: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      archiveImages: async (bookingId, input) => {
        assert.equal(bookingId, BOOKING_ID);
        assert.deepEqual(input.imageIds, [RETURN_IMAGE_ID]);
        assert.equal(input.archiveReason, "Retention cleanup");
        return {
          bookingId: BOOKING_ID,
          bookingPublicId: "BK000334",
          vehicleId: VEHICLE_ID,
          archiveReason: "Retention cleanup",
          archiveSource: "booking_inspection_retention",
          policy: {
            minimumAgeDays: BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS,
            evaluatedAt: "2026-03-15T12:00:00.000Z",
            eligibleBefore: "2025-03-15T12:00:00.000Z",
            bookingStatus: "RETURNED",
            bookingCompleted: true,
            bookingOldEnough: true,
            pickupCompleted: true,
            returnCompleted: true,
            hasReturnDamage: false,
            hasFuelMismatch: false,
            hasRefundOrReview: false,
          },
          eligibleCount: 1,
          ineligibleCount: 0,
          archivedCount: 1,
          skippedCount: 0,
          results: [
            {
              imageId: RETURN_IMAGE_ID,
              inspectionId: RETURN_INSPECTION_ID,
              inspectionType: "RETURN",
              category: "ODOMETER",
              generatedFileName: "BK000334-return-odometer-20250310T120000Z-01.jpg",
              originalFileName: null,
              createdAt: "2025-03-10T12:00:00.000Z",
              archivedAt: "2026-03-15T12:00:01.000Z",
              eligible: true,
              reasons: [],
              outcome: "ARCHIVED",
            },
          ],
        };
      },
      loadInspections: async () =>
        cleanCompletedInspectionSet({
          returnInspection: {
            ...cleanCompletedInspectionSet().returnInspection,
            imageCount: 2,
            images: cleanCompletedInspectionSet().returnInspection.images.slice(1),
          },
        }),
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    archiveRun?: { archivedCount?: number; results?: Array<{ outcome?: string }> };
    inspections?: { returnInspection?: { imageCount?: number } };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.archiveRun?.archivedCount, 1);
  assert.equal(payload.archiveRun?.results?.[0]?.outcome, "ARCHIVED");
  assert.equal(payload.inspections?.returnInspection?.imageCount, 2);
});

test("booking vehicle inspection route: odometer correction is admin-only", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CORRECT_ODOMETER",
        inspectionType: "pickup",
        inspectionId: PICKUP_INSPECTION_ID,
        correctedOdometerValue: 45220,
        correctionReason: "Correcting entry typo.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedUserResult(),
      requireCsrfCheck: async () => true,
    },
  );

  assert.equal(response.status, 403);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Only admin users can correct/i);
});

test("booking vehicle inspection route: odometer correction requires a reason", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CORRECT_ODOMETER",
        inspectionType: "pickup",
        inspectionId: PICKUP_INSPECTION_ID,
        correctedOdometerValue: 45220,
        correctionReason: "",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Correction reason is required/i);
});

test("booking vehicle inspection route: odometer correction writes audit and returns corrected summary", async () => {
  const audits: Array<{ action: string; details?: Record<string, unknown> }> = [];

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CORRECT_ODOMETER",
        inspectionType: "return",
        inspectionId: RETURN_INSPECTION_ID,
        correctedOdometerValue: 45280,
        correctionReason: "Corrected after double-entry check.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      correctInspectionOdometer: async () => ({
        ok: true,
        correction: {
          bookingId: BOOKING_ID,
          bookingPublicId: "BK000334",
          vehicleId: VEHICLE_ID,
          inspectionId: RETURN_INSPECTION_ID,
          inspectionType: "RETURN",
          previousOdometerValue: 45310,
          correctedOdometerValue: 45280,
          odometerUnit: "KM",
          vehiclePreviousOdometerValue: 45310,
          vehiclePreviousOdometerUnit: "KM",
          correctionReason: "Corrected after double-entry check.",
          correctedByUserId: "admin-user-id",
          correctedAt: "2026-03-17T15:00:00.000Z",
        },
      }),
      loadInspections: async () =>
        sampleCompletedInspectionSet({
          vehicleOdometerValue: 45280,
          vehicleOdometerUnit: "KM",
          returnInspection: {
            ...sampleCompletedInspectionSet().returnInspection,
            odometerValue: 45280,
            hasOdometerCorrection: true,
            odometerCorrectedFromValue: 45310,
            odometerCorrectionReason: "Corrected after double-entry check.",
            odometerCorrectedByUserId: "admin-user-id",
            odometerCorrectedByDisplay: "Admin User",
            odometerCorrectedAt: "2026-03-17T15:00:00.000Z",
          },
        }),
      writeAudit: async (input) => {
        audits.push({ action: input.action, details: input.details });
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    inspection?: {
      odometerValue?: number | null;
      hasOdometerCorrection?: boolean;
      odometerCorrectedFromValue?: number | null;
      odometerCorrectionReason?: string | null;
    };
    inspections?: { vehicleOdometerValue?: number | null };
  };
  assert.equal(payload.inspection?.odometerValue, 45280);
  assert.equal(payload.inspection?.hasOdometerCorrection, true);
  assert.equal(payload.inspection?.odometerCorrectedFromValue, 45310);
  assert.equal(payload.inspection?.odometerCorrectionReason, "Corrected after double-entry check.");
  assert.equal(payload.inspections?.vehicleOdometerValue, 45280);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "BOOKING_VEHICLE_INSPECTION_ODOMETER_CORRECTED");
  assert.equal(audits[0]?.details?.previousOdometerValue, 45310);
  assert.equal(audits[0]?.details?.correctedOdometerValue, 45280);
  assert.equal(audits[0]?.details?.correctionReason, "Corrected after double-entry check.");
  assert.equal(audits[0]?.details?.vehicleSourceOfTruthUpdated, true);
});

test("booking vehicle inspection route: invalid odometer correction values are rejected cleanly", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CORRECT_ODOMETER",
        inspectionType: "return",
        inspectionId: RETURN_INSPECTION_ID,
        correctedOdometerValue: -1,
        correctionReason: "Bad input",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Corrected odometer must be a non-negative whole number/i);
});

test("booking vehicle inspection route: PUT upserts draft inspection foundation state", async () => {
  let savedInput:
    | {
        bookingId: string;
        input: {
          inspectionType: string;
          status: string;
          odometerValue: number | null;
          odometerUnit: string | null;
          fuelLevelEighths: number | null;
          damagePresent: boolean;
          notes: string | null;
          recordedByUserId: string | null;
        };
      }
    | null = null;
  let auditAction: string | null = null;

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "draft",
        odometerValue: 45231,
        fuelLevelEighths: 6,
        damagePresent: false,
        notes: "Minor dust on exterior.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
      saveInspection: async (bookingId, input) => {
        savedInput = { bookingId, input };
        return {
          id: PICKUP_INSPECTION_ID,
          booking_id: bookingId,
          vehicle_id: VEHICLE_ID,
          inspection_type: "PICKUP",
          status: "DRAFT",
          odometer_value: 45231,
          odometer_unit: "KM",
          fuel_level_eighths: 6,
          damage_present: false,
          notes: "Minor dust on exterior.",
          recorded_by_user_id: "admin-user-id",
          recorded_by_display: "Admin User",
          completed_at: null,
          created_at: "2026-03-15T12:00:00.000Z",
          updated_at: "2026-03-15T12:30:00.000Z",
          image_count: 0,
        };
      },
      loadInspections: async () =>
        sampleInspectionSet({
          pickup: {
            ...sampleInspectionSet().pickup,
            displayStatusLabel: "In progress",
            recordStatus: "DRAFT",
            fuelLevelDisplay: "75%",
          },
          returnInspection: createEmptyBookingVehicleInspectionSummaries({
            bookingId: BOOKING_ID,
            bookingPublicId: "BK000334",
            vehicleId: VEHICLE_ID,
          }).returnInspection,
        }),
      writeAudit: async (input) => {
        auditAction = input.action;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(savedInput, {
    bookingId: BOOKING_ID,
    input: {
      inspectionType: "PICKUP",
      status: "DRAFT",
      odometerValue: 45231,
      odometerUnit: "KM",
      fuelLevelEighths: 6,
      damagePresent: false,
      notes: "Minor dust on exterior.",
      recordedByUserId: "admin-user-id",
    },
  });
  assert.equal(auditAction, "BOOKING_VEHICLE_INSPECTION_UPSERTED");

  const payload = (await response.json()) as {
    ok?: boolean;
    inspection?: { displayStatusLabel?: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.inspection?.displayStatusLabel, "In progress");
});

test("booking vehicle inspection route: draft save does not update vehicle odometer", async () => {
  let syncCalls = 0;

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "draft",
        odometerValue: 45231,
        fuelLevelEighths: 6,
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
      loadInspections: async () =>
        createEmptyBookingVehicleInspectionSummaries({
          bookingId: BOOKING_ID,
          bookingPublicId: "BK000334",
          vehicleId: VEHICLE_ID,
          vehicleOdometerValue: 45200,
          vehicleOdometerUnit: "KM",
        }),
      saveInspection: async () => ({
        id: PICKUP_INSPECTION_ID,
        booking_id: BOOKING_ID,
        vehicle_id: VEHICLE_ID,
        inspection_type: "PICKUP",
        status: "DRAFT",
        odometer_value: 45231,
        odometer_unit: "KM",
        fuel_level_eighths: 6,
        damage_present: false,
        notes: null,
        recorded_by_user_id: "admin-user-id",
        recorded_by_display: "Admin User",
        completed_at: null,
        created_at: "2026-03-15T12:00:00.000Z",
        updated_at: "2026-03-15T12:05:00.000Z",
        image_count: 0,
      }),
      syncVehicleOdometer: async () => {
        syncCalls += 1;
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(syncCalls, 0);
});

test("booking vehicle inspection route: completing pickup inspection requires odometer and fuel", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "completed",
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Enter an odometer reading/i);
});

test("booking vehicle inspection route: completion works and returns completed summary state", async () => {
  const syncCalls: Array<{ vehicleId: string; odometerValue: number; odometerUnit: string | null }> = [];
  let loadCalls = 0;

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "completed",
        odometerValue: 45231,
        odometerUnit: "KM",
        fuelLevelEighths: 6,
        damagePresent: false,
        notes: "Vehicle checked and ready.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
      loadInspections: async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          return createEmptyBookingVehicleInspectionSummaries({
            bookingId: BOOKING_ID,
            bookingPublicId: "BK000334",
            vehicleId: VEHICLE_ID,
            vehicleOdometerValue: 45200,
            vehicleOdometerUnit: "KM",
          });
        }
        return sampleInspectionSet({
          vehicleOdometerValue: 45231,
          vehicleOdometerUnit: "KM",
          pickup: {
            ...sampleInspectionSet().pickup,
            recordStatus: "COMPLETED",
            displayStatus: "COMPLETED",
            displayStatusLabel: "Completed",
            notes: "Vehicle checked and ready.",
            noteSnippet: "Vehicle checked and ready.",
            completedAt: "2026-03-15T14:00:00.000Z",
            recordedAt: "2026-03-15T14:00:00.000Z",
          },
        });
      },
      saveInspection: async () => ({
        id: PICKUP_INSPECTION_ID,
        booking_id: BOOKING_ID,
        vehicle_id: VEHICLE_ID,
        inspection_type: "PICKUP",
        status: "COMPLETED",
        odometer_value: 45231,
        odometer_unit: "KM",
        fuel_level_eighths: 6,
        damage_present: false,
        notes: "Vehicle checked and ready.",
        recorded_by_user_id: "admin-user-id",
        recorded_by_display: "Admin User",
        completed_at: "2026-03-15T14:00:00.000Z",
        created_at: "2026-03-15T13:00:00.000Z",
        updated_at: "2026-03-15T14:00:00.000Z",
        image_count: 0,
      }),
      syncVehicleOdometer: async (input) => {
        syncCalls.push(input);
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    inspection?: { displayStatusLabel?: string; completedAt?: string | null };
    inspections?: { vehicleOdometerValue?: number | null };
  };
  assert.equal(payload.inspection?.displayStatusLabel, "Completed");
  assert.equal(payload.inspection?.completedAt, "2026-03-15T14:00:00.000Z");
  assert.deepEqual(syncCalls, [
    {
      vehicleId: VEHICLE_ID,
      odometerValue: 45231,
      odometerUnit: "KM",
    },
  ]);
  assert.equal(payload.inspections?.vehicleOdometerValue, 45231);
});

test("booking vehicle inspection route: completion blocks odometer rollback against vehicle", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "completed",
        odometerValue: 45199,
        fuelLevelEighths: 6,
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
      loadInspections: async () =>
        createEmptyBookingVehicleInspectionSummaries({
          bookingId: BOOKING_ID,
          bookingPublicId: "BK000334",
          vehicleId: VEHICLE_ID,
          vehicleOdometerValue: 45200,
          vehicleOdometerUnit: "KM",
        }),
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /at or above the vehicle's current reading/i);
  assert.match(payload.error ?? "", /45,200 KM/i);
});

test("booking vehicle inspection route: pickup inspection is locked after pickup-confirmed stage", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "pickup",
        status: "draft",
        odometerValue: 45231,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /read-only after pickup is confirmed/i);
});

test("booking vehicle inspection route: return draft save works after pickup", async () => {
  let savedInput:
    | {
        bookingId: string;
        input: {
          inspectionType: string;
          status: string;
          odometerValue: number | null;
          odometerUnit: string | null;
          fuelLevelEighths: number | null;
          damagePresent: boolean;
          notes: string | null;
          recordedByUserId: string | null;
        };
      }
    | null = null;

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "draft",
        odometerValue: 45310,
        odometerUnit: "KM",
        fuelLevelEighths: 5,
        damagePresent: true,
        notes: "Scratch noted on rear bumper.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
      saveInspection: async (bookingId, input) => {
        savedInput = { bookingId, input };
        return {
          id: RETURN_INSPECTION_ID,
          booking_id: bookingId,
          vehicle_id: VEHICLE_ID,
          inspection_type: "RETURN",
          status: "DRAFT",
          odometer_value: 45310,
          odometer_unit: "KM",
          fuel_level_eighths: 5,
          damage_present: true,
          notes: "Scratch noted on rear bumper.",
          recorded_by_user_id: "admin-user-id",
          recorded_by_display: "Admin User",
          completed_at: null,
          created_at: "2026-03-17T13:00:00.000Z",
          updated_at: "2026-03-17T13:20:00.000Z",
          image_count: 0,
        };
      },
      loadInspections: async () =>
        sampleInspectionSet({
          returnInspection: {
            ...sampleInspectionSet().returnInspection,
            recordStatus: "DRAFT",
            displayStatus: "IN_PROGRESS",
            displayStatusLabel: "In progress",
            completedAt: null,
            recordedAt: "2026-03-17T13:20:00.000Z",
          },
        }),
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(savedInput, {
    bookingId: BOOKING_ID,
    input: {
      inspectionType: "RETURN",
      status: "DRAFT",
      odometerValue: 45310,
      odometerUnit: "KM",
      fuelLevelEighths: 5,
      damagePresent: true,
      notes: "Scratch noted on rear bumper.",
      recordedByUserId: "admin-user-id",
    },
  });

  const payload = (await response.json()) as {
    inspection?: { displayStatusLabel?: string };
  };
  assert.equal(payload.inspection?.displayStatusLabel, "In progress");
});

test("booking vehicle inspection route: return draft save does not update vehicle odometer", async () => {
  let syncCalls = 0;

  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "draft",
        odometerValue: 45310,
        odometerUnit: "KM",
        fuelLevelEighths: 5,
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
      loadInspections: async () =>
        sampleCompletedInspectionSet({
          vehicleOdometerValue: 45231,
          vehicleOdometerUnit: "KM",
          returnInspection: createEmptyBookingVehicleInspectionSummaries({
            bookingId: BOOKING_ID,
            bookingPublicId: "BK000334",
            vehicleId: VEHICLE_ID,
            vehicleOdometerValue: 45231,
            vehicleOdometerUnit: "KM",
          }).returnInspection,
        }),
      saveInspection: async () => ({
        id: RETURN_INSPECTION_ID,
        booking_id: BOOKING_ID,
        vehicle_id: VEHICLE_ID,
        inspection_type: "RETURN",
        status: "DRAFT",
        odometer_value: 45310,
        odometer_unit: "KM",
        fuel_level_eighths: 5,
        damage_present: false,
        notes: null,
        recorded_by_user_id: "admin-user-id",
        recorded_by_display: "Admin User",
        completed_at: null,
        created_at: "2026-03-17T13:00:00.000Z",
        updated_at: "2026-03-17T13:05:00.000Z",
        image_count: 0,
      }),
      syncVehicleOdometer: async () => {
        syncCalls += 1;
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(syncCalls, 0);
});

test("booking vehicle inspection route: completing return inspection requires odometer and fuel", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "completed",
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /return inspection/i);
  assert.match(payload.error ?? "", /enter an odometer reading/i);
});

test("booking vehicle inspection route: completing a damage inspection requires a damage image", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "completed",
        odometerValue: 45310,
        odometerUnit: "KM",
        fuelLevelEighths: 5,
        damagePresent: true,
        notes: "Scratch noted on rear bumper.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
      loadInspections: async () =>
        sampleCompletedInspectionSet({
          vehicleOdometerValue: 45231,
          vehicleOdometerUnit: "KM",
          returnInspection: {
            ...createEmptyBookingVehicleInspectionSummaries({
              bookingId: BOOKING_ID,
              bookingPublicId: "BK000334",
              vehicleId: VEHICLE_ID,
              vehicleOdometerValue: 45231,
              vehicleOdometerUnit: "KM",
            }).returnInspection,
            inspectionId: RETURN_INSPECTION_ID,
            recordStatus: "DRAFT",
            displayStatus: "IN_PROGRESS",
            displayStatusLabel: "In progress",
            damagePresent: true,
            damageDisplay: "Yes",
          },
        }),
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Damage category/i);
});

test("booking vehicle inspection route: return completion works and returns completed summary state", async () => {
  let processedIssues = 0;
  const syncCalls: Array<{ vehicleId: string; odometerValue: number; odometerUnit: string | null }> = [];
  let loadCalls = 0;
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "completed",
        odometerValue: 45310,
        odometerUnit: "KM",
        fuelLevelEighths: 5,
        damagePresent: true,
        notes: "Scratch noted on rear bumper.",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
      loadInspections: async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          return sampleCompletedInspectionSet({
            vehicleOdometerValue: 45231,
            vehicleOdometerUnit: "KM",
            returnInspection: {
              ...sampleInspectionSet().returnInspection,
              recordStatus: "DRAFT",
              displayStatus: "IN_PROGRESS",
              displayStatusLabel: "In progress",
              completedAt: null,
              recordedAt: "2026-03-17T13:20:00.000Z",
            },
          });
        }
        return sampleInspectionSet({
          vehicleOdometerValue: 45310,
          vehicleOdometerUnit: "KM",
          returnInspection: {
            ...sampleInspectionSet().returnInspection,
            recordStatus: "COMPLETED",
            displayStatus: "COMPLETED",
            displayStatusLabel: "Completed",
            completedAt: "2026-03-17T14:00:00.000Z",
            recordedAt: "2026-03-17T14:00:00.000Z",
          },
        });
      },
      saveInspection: async () => ({
        id: RETURN_INSPECTION_ID,
        booking_id: BOOKING_ID,
        vehicle_id: VEHICLE_ID,
        inspection_type: "RETURN",
        status: "COMPLETED",
        odometer_value: 45310,
        odometer_unit: "KM",
        fuel_level_eighths: 5,
        damage_present: true,
        notes: "Scratch noted on rear bumper.",
        recorded_by_user_id: "admin-user-id",
        recorded_by_display: "Admin User",
        completed_at: "2026-03-17T14:00:00.000Z",
        created_at: "2026-03-17T13:00:00.000Z",
        updated_at: "2026-03-17T14:00:00.000Z",
        image_count: 0,
      }),
      syncVehicleOdometer: async (input) => {
        syncCalls.push(input);
      },
      processInspectionIssues: async () => {
        processedIssues += 1;
        return { fuelMismatchCreated: true, returnDamageCreated: true };
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    inspection?: { displayStatusLabel?: string; completedAt?: string | null; odometerValue?: number | null };
    inspections?: {
      vehicleOdometerValue?: number | null;
      pickup?: { odometerValue?: number | null };
    };
  };
  assert.equal(payload.inspection?.displayStatusLabel, "Completed");
  assert.equal(payload.inspection?.completedAt, "2026-03-17T14:00:00.000Z");
  assert.equal(processedIssues, 1);
  assert.deepEqual(syncCalls, [
    {
      vehicleId: VEHICLE_ID,
      odometerValue: 45310,
      odometerUnit: "KM",
    },
  ]);
  assert.equal(payload.inspection?.odometerValue, 45310);
  assert.equal(payload.inspections?.vehicleOdometerValue, 45310);
  assert.equal(payload.inspections?.pickup?.odometerValue, 45231);
});

test("booking vehicle inspection route: return completion blocks odometer rollback against pickup", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "completed",
        odometerValue: 45230,
        odometerUnit: "KM",
        fuelLevelEighths: 5,
        damagePresent: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "PICKED_UP",
      loadInspections: async () =>
        sampleCompletedInspectionSet({
          vehicleOdometerValue: 45231,
          vehicleOdometerUnit: "KM",
          returnInspection: createEmptyBookingVehicleInspectionSummaries({
            bookingId: BOOKING_ID,
            bookingPublicId: "BK000334",
            vehicleId: VEHICLE_ID,
            vehicleOdometerValue: 45231,
            vehicleOdometerUnit: "KM",
          }).returnInspection,
        }),
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /completed pickup reading/i);
  assert.match(payload.error ?? "", /45,231 KM/i);
});

test("booking vehicle inspection route: return inspection remains unavailable before pickup", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "draft",
        odometerValue: 45310,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "CONFIRMED",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Confirm pickup first/i);
});

test("booking vehicle inspection route: return inspection is locked after booking completion", async () => {
  const response = await handleAdminBookingInspectionsPut(
    new Request(`http://localhost/api/admin/bookings/${BOOKING_ID}/inspections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionType: "return",
        status: "draft",
        odometerValue: 45310,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      requireCsrfCheck: async () => true,
      getBookingStatus: async () => "RETURNED",
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /read-only after the booking is completed/i);
});

test("booking vehicle inspection panel: renders pickup/return summary cards and disabled return state before pickup", () => {
  const empty = createEmptyBookingVehicleInspectionSummaries({
    bookingId: BOOKING_ID,
    bookingPublicId: "BK000334",
    vehicleId: VEHICLE_ID,
  });
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="CONFIRMED"
      bookingPublicId="BK000334"
      inspections={empty}
    />,
  );

  assert.match(html, /Pickup Inspection/);
  assert.match(html, /Return Inspection/);
  assert.match(html, /Not started/);
  assert.match(html, /0 photos/);
  assert.match(
    html,
    /Uploading the first image will save this inspection as a draft automatically\. Then you can add odometer, fuel, exterior, or damage photos\./i,
  );
  assert.match(html, /Return inspection becomes available after pickup is confirmed\./);
  assert.doesNotMatch(html, /Complete return inspection/);
});

test("booking vehicle inspection panel: renders uploaded inspection images with preview links", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="PICKED_UP"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet()}
    />,
  );

  assert.match(html, /Inspection images/);
  assert.match(html, /BK000334-return-damage-/);
  assert.match(html, /Fuel gauge/);
  assert.match(html, /3 photos/);
  assert.match(html, /Open/);
  assert.match(html, /https:\/\/ucarecdn\.com\/return-image\//);
});

test("booking vehicle inspection panel: pickup inspection prefills odometer from vehicle when new", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="CONFIRMED"
      bookingPublicId="BK000334"
      inspections={createEmptyBookingVehicleInspectionSummaries({
        bookingId: BOOKING_ID,
        bookingPublicId: "BK000334",
        vehicleId: VEHICLE_ID,
        vehicleOdometerValue: 45200,
        vehicleOdometerUnit: "KM",
      })}
    />,
  );

  assert.match(html, /value="45200"/);
});

test("booking vehicle inspection panel: new pickup inspection offers automatic draft creation before upload", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="CONFIRMED"
      bookingPublicId="BK000334"
      inspections={createEmptyBookingVehicleInspectionSummaries({
        bookingId: BOOKING_ID,
        bookingPublicId: "BK000334",
        vehicleId: VEHICLE_ID,
        vehicleOdometerValue: 45200,
        vehicleOdometerUnit: "KM",
      })}
    />,
  );

  assert.match(html, /Save draft &amp; upload selected category/);
  assert.match(
    html,
    /The first upload will save this inspection as a draft automatically\./,
  );
});

test("booking vehicle inspection panel: pickup form renders existing values while pre-pickup", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="CONFIRMED"
      bookingPublicId="BK000334"
      inspections={sampleInspectionSet()}
    />,
  );

  assert.match(html, /Save draft/);
  assert.match(html, /Complete pickup inspection/);
  assert.match(html, /Editable/);
  assert.match(html, /value="45231"/);
  assert.doesNotMatch(html, /value="45200"/);
  assert.match(html, /Minor dust on exterior\./);
});

test("booking vehicle inspection panel: return inspection prefills odometer from vehicle after pickup", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="PICKED_UP"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet({
        vehicleOdometerValue: 45231,
        vehicleOdometerUnit: "KM",
        returnInspection: createEmptyBookingVehicleInspectionSummaries({
          bookingId: BOOKING_ID,
          bookingPublicId: "BK000334",
          vehicleId: VEHICLE_ID,
          vehicleOdometerValue: 45231,
          vehicleOdometerUnit: "KM",
        }).returnInspection,
      })}
    />,
  );

  assert.match(html, /Complete return inspection/);
  assert.match(html, /value="45231"/);
});

test("booking vehicle inspection panel: locks pickup form and keeps return scaffold after pickup", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="PICKED_UP"
      bookingPublicId="BK000334"
      inspections={sampleInspectionSet({
        returnInspection: {
          ...sampleInspectionSet().returnInspection,
          recordStatus: "DRAFT",
          displayStatus: "IN_PROGRESS",
          displayStatusLabel: "In progress",
          completedAt: null,
          recordedAt: "2026-03-17T13:20:00.000Z",
        },
      })}
    />,
  );

  assert.doesNotMatch(html, /Complete pickup inspection/);
  assert.match(html, /Save draft/);
  assert.match(html, /Complete return inspection/);
  assert.match(html, /Pickup inspection is now read-only because pickup has been confirmed\./);
  assert.match(html, /value="45310"/);
  assert.match(html, /Scratch noted on rear bumper\./);
  assert.doesNotMatch(html, /Return inspection is now read-only because the booking has been completed\./);
});

test("booking vehicle inspection panel: locks return form after booking completion", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet()}
    />,
  );

  assert.doesNotMatch(html, /Save draft/);
  assert.doesNotMatch(html, /Complete return inspection/);
  assert.match(html, /Return inspection is now read-only because the booking has been completed\./);
});

test("booking vehicle inspection panel: correction action is shown only to authorized users", () => {
  const unauthorizedHtml = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet()}
    />,
  );
  const authorizedHtml = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet()}
      canCorrectOdometer
    />,
  );

  assert.doesNotMatch(unauthorizedHtml, /Correct odometer/);
  assert.match(authorizedHtml, /Correct odometer/);
});

test("booking vehicle inspection panel: corrected-state summary is displayed", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet({
        vehicleOdometerValue: 45280,
        vehicleOdometerUnit: "KM",
        returnInspection: {
          ...sampleCompletedInspectionSet().returnInspection,
          odometerValue: 45280,
          hasOdometerCorrection: true,
          odometerCorrectedFromValue: 45310,
          odometerCorrectionReason: "Corrected after double-entry check.",
          odometerCorrectedByUserId: "admin-user-id",
          odometerCorrectedByDisplay: "Admin User",
          odometerCorrectedAt: "2026-03-17T15:00:00.000Z",
        },
      })}
      canCorrectOdometer
    />,
  );

  assert.match(html, /Corrected/);
  assert.match(html, /45,310 KM/);
  assert.match(html, /45,280 KM/);
  assert.doesNotMatch(html, /-&gt;/);
  assert.match(html, /Corrected after double-entry check\./);
  assert.match(html, /Admin User/);
});

test("booking vehicle inspection panel: shows warning indicators for fuel mismatch and damage", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleCompletedInspectionSet()}
    />,
  );

  assert.match(html, /Inspection follow-up needed/);
  assert.match(html, /Fuel mismatch/);
  assert.match(html, /Damage reported/);
  assert.match(html, /Return fuel \(62.5%\) is below pickup fuel \(75%\)/);
  assert.match(html, /do not block completion/i);
});

test("booking vehicle inspection panel: stays quiet when there are no warning conditions", () => {
  const html = renderToStaticMarkup(
    <BookingVehicleInspectionPanel
      bookingId={BOOKING_ID}
      bookingStatus="RETURNED"
      bookingPublicId="BK000334"
      inspections={sampleInspectionSet({
        pickup: {
          ...sampleInspectionSet().pickup,
          recordStatus: "COMPLETED",
          displayStatus: "COMPLETED",
          displayStatusLabel: "Completed",
        },
        returnInspection: {
          ...sampleInspectionSet().returnInspection,
          fuelLevelEighths: 6,
          fuelLevelDisplay: "75%",
          damagePresent: false,
          damageDisplay: "No",
        },
      })}
    />,
  );

  assert.doesNotMatch(html, /Inspection warnings/);
  assert.doesNotMatch(html, /Fuel mismatch/);
  assert.doesNotMatch(html, /Damage reported/);
});

test("booking vehicle inspection foundation: action tab and unique inspection constraint are present", () => {
  const bookingActionsSource = readFileSync(
    "src/components/admin/BookingActions.tsx",
    "utf8",
  );
  const migrationSource = readFileSync(
    "migrations/041_booking_vehicle_inspections.sql",
    "utf8",
  );

  assert.match(bookingActionsSource, /Vehicle Inspection/);
  assert.match(migrationSource, /unique\s+\(booking_id,\s*inspection_type\)/i);
});

test("admin booking pickup action: blocks confirmation without completed pickup inspection", async () => {
  const response = await handleAdminBookingPickupAction(BOOKING_ID, authorizedStaffResult().session, {
    query: async <T = unknown>(text: string) => {
      if (text.startsWith("select b.status")) {
        return {
          rows: [
            {
              status: "CONFIRMED",
              start_date: "2026-03-15",
              end_date: "2026-03-17",
              pricing_json: {},
              daily_rate_cents: 6200,
              deposit_cents: 1860,
            },
          ] as T[],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    fetchNetPaid: async () => 18600,
    hasCompletedPickupInspection: async () => false,
    writeAudit: async () => undefined,
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Complete the pickup inspection in Vehicle Inspection before confirming pickup/i);
});

test("admin booking pickup action: succeeds when completed pickup inspection exists", async () => {
  const queries: string[] = [];
  const response = await handleAdminBookingPickupAction(BOOKING_ID, authorizedStaffResult().session, {
    query: async <T = unknown>(text: string, params?: unknown[]) => {
      queries.push(text);
      if (text.startsWith("select b.status")) {
        return {
          rows: [
            {
              status: "CONFIRMED",
              start_date: "2026-03-15",
              end_date: "2026-03-17",
              pricing_json: {
                total_cents: 18600,
                paid_to_date: 18600,
                balance_due: 0,
                payment_status: "PAID_IN_FULL",
              },
              daily_rate_cents: 6200,
              deposit_cents: 1860,
            },
          ] as T[],
          rowCount: 1,
        };
      }
      if (text.startsWith("update bookings set status = 'PICKED_UP'")) {
        assert.deepEqual(params, [BOOKING_ID]);
        return { rows: [] as T[], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    fetchNetPaid: async () => 18600,
    hasCompletedPickupInspection: async () => true,
    writeAudit: async () => undefined,
  });

  assert.equal(response.status, 200);
  assert.ok(queries.some((entry) => entry.startsWith("update bookings set status = 'PICKED_UP'")));
});

test("admin booking complete action: blocks completion without completed return inspection", async () => {
  const response = await handleAdminBookingCompleteAction(
    BOOKING_ID,
    authorizedStaffResult().session,
    {
      query: async <T = unknown>(text: string) => {
        if (text.startsWith("select status from bookings")) {
          return {
            rows: [{ status: "PICKED_UP" }] as T[],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      hasCompletedReturnInspection: async () => false,
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Complete the return inspection in Vehicle Inspection before completing the booking/i);
});

test("admin booking complete action: no longer finalizes directly from confirmed", async () => {
  const response = await handleAdminBookingCompleteAction(
    BOOKING_ID,
    authorizedStaffResult().session,
    {
      query: async <T = unknown>(text: string) => {
        if (text.startsWith("select status from bookings")) {
          return {
            rows: [{ status: "CONFIRMED" }] as T[],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      hasCompletedReturnInspection: async () => true,
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Only picked-up bookings can be completed/i);
});

test("admin booking complete action: succeeds when completed return inspection exists", async () => {
  const queries: string[] = [];
  const response = await handleAdminBookingCompleteAction(
    BOOKING_ID,
    authorizedStaffResult().session,
    {
      query: async <T = unknown>(text: string, params?: unknown[]) => {
        queries.push(text);
        if (text.startsWith("select status from bookings")) {
          return {
            rows: [{ status: "PICKED_UP" }] as T[],
            rowCount: 1,
          };
        }
        if (text.startsWith("update bookings set status = 'RETURNED'")) {
          assert.deepEqual(params, [BOOKING_ID, "admin-user-id", "Completed/Returned"]);
          return { rows: [] as T[], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      hasCompletedReturnInspection: async () => true,
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.ok(queries.some((entry) => entry.startsWith("update bookings set status = 'RETURNED'")));
});

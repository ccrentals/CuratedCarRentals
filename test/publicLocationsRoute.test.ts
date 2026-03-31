import assert from "node:assert/strict";
import test from "node:test";

import { handlePublicLocationsGet } from "@/app/api/public/locations/route";

test("public locations API returns the exact phase-1 location set", async () => {
  const response = await handlePublicLocationsGet({
    listLocations: async () => [
      {
        id: "1",
        label: "168 1/2 Old Hope Road, Kingston Jamaica",
        allow_pickup: true,
        allow_dropoff: true,
        sort_order: 1,
      },
      {
        id: "2",
        label: "Norman Manley Airport",
        allow_pickup: true,
        allow_dropoff: true,
        sort_order: 2,
      },
    ],
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    locations: Array<{ label: string; pickup_label: string; dropoff_label: string; location_type: string }>;
  };
  assert.deepEqual(
    payload.locations.map((location) => ({
      label: location.label,
      pickup: location.pickup_label,
      dropoff: location.dropoff_label,
      type: location.location_type,
    })),
    [
      {
        label: "168 1/2 Old Hope Road, Kingston Jamaica",
        pickup: "168 1/2 Old Hope Road, Kingston Jamaica",
        dropoff: "168 1/2 Old Hope Road, Kingston Jamaica",
        type: "OFFICE",
      },
      {
        label: "Norman Manley Airport",
        pickup: "Norman Manley Airport",
        dropoff: "Norman Manley Airport",
        type: "AIRPORT",
      },
      {
        label: "Custom Address",
        pickup: "Pick up Address",
        dropoff: "Return Address",
        type: "CUSTOM_ADDRESS",
      },
    ],
  );
});

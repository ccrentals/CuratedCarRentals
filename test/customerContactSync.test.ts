import assert from "node:assert/strict";
import test from "node:test";

import {
  CustomerNotFoundError,
  synchronizeCustomerContact,
  type CustomerContactQueryClient,
} from "@/lib/customers/customerContactSync";

test("customer contact sync updates the customer and every booking linked by customer_id", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client: CustomerContactQueryClient = {
    async query(text, params) {
      calls.push({ text, params });
      if (text.includes("update customers")) {
        return { rowCount: 1, rows: [{ id: "customer-1" }] };
      }
      return { rowCount: 3, rows: [] };
    },
  };

  const result = await synchronizeCustomerContact(client, "customer-1", {
    fullName: "Jordan Mcclure",
    email: "mcclurejordan@gmail.com",
    phone: "8764315038",
  });

  assert.equal(result.synchronizedBookingCount, 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.params, [
    "customer-1",
    "Jordan Mcclure",
    "mcclurejordan@gmail.com",
    "8764315038",
  ]);
  assert.deepEqual(calls[1]?.params, calls[0]?.params);
  assert.match(calls[1]?.text ?? "", /where customer_id = \$1/);
  assert.match(calls[1]?.text ?? "", /coalesce\(pricing_json, '\{\}'::jsonb\)/);
  assert.match(calls[1]?.text ?? "", /\{customer_name_snapshot\}/);
  assert.match(calls[1]?.text ?? "", /\{customer_email_snapshot\}/);
  assert.match(calls[1]?.text ?? "", /\{customer_phone_snapshot\}/);
  assert.match(calls[1]?.text ?? "", /customer_phone_snapshot = \$4/);
});

test("customer contact sync stops before changing bookings when the customer does not exist", async () => {
  const calls: string[] = [];
  const client: CustomerContactQueryClient = {
    async query(text) {
      calls.push(text);
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    synchronizeCustomerContact(client, "missing-customer", {
      fullName: "Missing Customer",
      email: "missing@example.com",
      phone: "8760000000",
    }),
    CustomerNotFoundError,
  );
  assert.equal(calls.length, 1);
});

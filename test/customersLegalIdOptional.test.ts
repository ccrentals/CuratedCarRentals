import assert from "node:assert/strict";
import test from "node:test";

import { upsertCustomerForBooking } from "@/lib/customers";

type QueryCall = {
  text: string;
  params: unknown[];
};

test("upsertCustomerForBooking treats undefined legal ID fields as not provided", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.includes("from customers where lower(email) = lower($1) or phone = $2")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith("insert into customers")) {
        return { rows: [{ id: "customer-1" }], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await upsertCustomerForBooking(
    {
      fullName: "Debug User",
      email: "debug@example.com",
      phone: "8760000000",
      legalIdType: undefined,
      legalIdNumber: undefined,
    },
    { client },
  );

  assert.equal(result.created, true);
  assert.equal(result.customerId, "customer-1");

  const insertCall = calls.find((call) => call.text.startsWith("insert into customers"));
  assert.ok(insertCall);
  assert.equal(insertCall.params[6], null);
  assert.equal(insertCall.params[7], null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { retireItineraryCheckout, ItineraryPaymentPending } from "@/lib/payments/itineraryCheckout";

function fixture(session: Record<string, unknown>, expire?: () => Promise<unknown>) {
  const updates: unknown[][] = [];
  let expired = 0;
  const client = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("select")) return {rows:[{id:"p",provider_ref:"cs_test",metadata_json:{}}],rowCount:1};
    updates.push(params); return {rows:[],rowCount:1};
  } };
  const stripe = (() => ({ checkout: {sessions: {
    retrieve: async () => session,
    expire: async () => { expired++; return expire ? expire() : {...session,status:"expired"}; },
  }} })) as Parameters<typeof retireItineraryCheckout>[3];
  return {client,stripe,updates,expired:()=>expired};
}
test("itinerary retires an unpaid open Checkout before booking mutation", async () => {
  const f=fixture({id:"cs_test",status:"open",payment_status:"unpaid"});
  await retireItineraryCheckout(f.client,"b",undefined,f.stripe);
  assert.equal(f.expired(),1); assert.equal(f.updates.length,1);
  assert.match(String(f.updates[0][0]),/expired_for_itinerary_change_at/);
});
test("completed payment requires reconciliation outside booking transaction and a new preview", async () => {
  const f=fixture({id:"cs_test",status:"complete",payment_status:"paid"});
  await assert.rejects(retireItineraryCheckout(f.client,"b",undefined,f.stripe), (e: unknown) => e instanceof ItineraryPaymentPending && e.completedSession?.id === "cs_test");
  assert.equal(f.expired(),0); assert.equal(f.updates.length,0);
});
test("processing or unknown Checkout state blocks repricing without failing the payment", async () => {
  for (const status of ["complete",null]) {
    const f=fixture({id:"cs_test",status,payment_status:"unpaid"});
    await assert.rejects(retireItineraryCheckout(f.client,"b",undefined,f.stripe),ItineraryPaymentPending);
    assert.equal(f.updates.length,0);
  }
  const f=fixture({id:"cs_test",status:"open",payment_status:"unpaid"},async()=>{throw Error("network");});
  await assert.rejects(retireItineraryCheckout(f.client,"b",undefined,f.stripe),ItineraryPaymentPending);
  assert.equal(f.updates.length,0);
});
test("expiration race cannot silently overwrite a completed payment", async () => {
  const f=fixture({id:"cs_test",status:"open",payment_status:"unpaid"},async()=>({status:"complete",payment_status:"paid"}));
  await assert.rejects(retireItineraryCheckout(f.client,"b",undefined,f.stripe),ItineraryPaymentPending);
  assert.equal(f.updates.length,0);
});

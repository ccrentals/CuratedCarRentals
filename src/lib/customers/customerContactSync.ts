export type CustomerContact = {
  fullName: string;
  email: string;
  phone: string;
};

export type CustomerContactQueryClient = {
  query: <T = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: T[] }>;
};

export class CustomerNotFoundError extends Error {
  constructor() {
    super("Customer not found");
    this.name = "CustomerNotFoundError";
  }
}

export async function synchronizeCustomerContact(
  client: CustomerContactQueryClient,
  customerId: string,
  contact: CustomerContact,
) {
  const customerResult = await client.query(
    "update customers set full_name = $2, email = $3, phone = $4 where id = $1 returning id",
    [customerId, contact.fullName, contact.email, contact.phone],
  );

  if (!customerResult.rowCount) {
    throw new CustomerNotFoundError();
  }

  const bookingResult = await client.query(
    `update bookings
     set pricing_json = jsonb_set(
       jsonb_set(
         jsonb_set(
           coalesce(pricing_json, '{}'::jsonb),
           '{customer_name_snapshot}',
           to_jsonb($2::text),
           true
         ),
         '{customer_email_snapshot}',
         to_jsonb($3::text),
         true
       ),
       '{customer_phone_snapshot}',
       to_jsonb($4::text),
       true
     )
     where customer_id = $1`,
    [customerId, contact.fullName, contact.email, contact.phone],
  );

  return {
    synchronizedBookingCount: bookingResult.rowCount ?? 0,
  };
}

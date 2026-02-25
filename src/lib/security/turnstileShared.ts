export const TURNSTILE_DEV_BYPASS_TOKEN = "ccr-dev-turnstile-bypass";

export type TurnstileAction =
  | "public_booking"
  | "public_contact"
  | "public_returning_customer"
  | "public_clerk_account_setup";

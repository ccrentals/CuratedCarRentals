import { PublicBookingWizard } from "@/components/booking/PublicBookingWizard";

export default function BookPage() {
  const turnstileDevBypassEnabled =
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_TURNSTILE_DEV_BYPASS?.trim() ?? "") === "1";
  return <PublicBookingWizard turnstileDevBypassEnabled={turnstileDevBypassEnabled} />;
}

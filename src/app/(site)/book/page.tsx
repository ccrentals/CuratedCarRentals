import { PublicBookingWizard } from "@/components/booking/PublicBookingWizard";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Book a Rental Car in Jamaica",
  description:
    "Choose pickup and dropoff dates, compare available vehicles, review pricing, and reserve a Curated Car Rentals vehicle online.",
  path: "/book",
});

export default function BookPage() {
  const turnstileDevBypassEnabled =
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_TURNSTILE_DEV_BYPASS?.trim() ?? "") === "1";
  return <PublicBookingWizard turnstileDevBypassEnabled={turnstileDevBypassEnabled} />;
}

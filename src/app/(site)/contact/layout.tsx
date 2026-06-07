import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Contact Curated Car Rentals",
  description:
    "Contact Curated Car Rentals in Kingston, Jamaica for booking questions, airport pickup support, vehicle guidance, and rental assistance.",
  path: "/contact",
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}

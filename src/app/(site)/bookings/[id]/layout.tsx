import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata;

export default function PublicBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="pt-4 sm:pt-6 min-[1160px]:pt-8 print:pt-0">{children}</div>;
}

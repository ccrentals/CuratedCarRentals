import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata;

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}

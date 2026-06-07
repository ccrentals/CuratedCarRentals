import { JsonLd } from "@/components/seo/JsonLd";
import {
  businessStructuredData,
  websiteStructuredData,
} from "@/lib/structuredData";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={[businessStructuredData(), websiteStructuredData()]} />
      {children}
    </>
  );
}

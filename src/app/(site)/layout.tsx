import { JsonLd } from "@/components/seo/JsonLd";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { loadLandingContent } from "@/lib/landingContent";
import {
  businessStructuredData,
  websiteStructuredData,
} from "@/lib/structuredData";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { content } = await loadLandingContent();
  return (
    <>
      <JsonLd data={[businessStructuredData(content.global), websiteStructuredData(content.global)]} />
      <div data-site-header>
        <Header content={content.global} />
      </div>
      {children}
      <div data-site-footer>
        <Footer content={content.global} serviceItems={content.services.items} />
      </div>
    </>
  );
}

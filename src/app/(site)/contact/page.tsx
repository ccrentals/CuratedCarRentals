import { ContactPageContent } from "@/components/site/ContactPageContent";
import { loadLandingContent } from "@/lib/landingContent";

export default async function ContactPage() {
  const { content } = await loadLandingContent();
  return <ContactPageContent content={content.contact} globalContent={content.global} />;
}

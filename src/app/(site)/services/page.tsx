import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { PublicStoryBlock } from "@/components/site/PublicStoryBlock";
import { Button } from "@/components/ui/Button";
import { services } from "@/data/services";

const serviceImages = [
  "/cars/real/toyota-corolla-2020-1.jpg",
  "/cars/real/nissan-xtrail-1.jpg",
  "/cars/real/honda-fit-2020-3.jpg",
  "/cars/real/toyota-yaris-2020-2.jpg",
  "/cars/real/toyota-corolla-2020-3.jpg",
];

export default function ServicesPage() {
  return (
    <>
      <PublicPageIntro
        eyebrow="Services"
        title="Our Services"
        description="At Curated Car Rentals, we offer more than just vehicles. Discover our premium services designed to make your Jamaican journey exceptional."
        primaryAction={{ href: "/book", label: "Book Now" }}
        secondaryAction={{ href: "/fleet", label: "Explore Fleet" }}
      >
        <div className="flex flex-wrap gap-2">
          {services.map((service) => (
            <a
              key={service.id}
              href={`#${service.id}`}
              className="rounded-full border border-white/15 bg-white/6 px-4 py-2 text-sm font-medium text-white/78 transition hover:bg-white/10 hover:text-white"
            >
              {service.title}
            </a>
          ))}
        </div>
      </PublicPageIntro>

      <PublicSection className="pt-12 md:pt-16">
        <div className="space-y-16 md:space-y-24">
          {services.map((service, index) => (
            <div key={service.id} id={service.id} className="scroll-mt-32">
              <PublicStoryBlock
                eyebrow="Premium Service"
                title={service.title}
                paragraphs={[service.description, service.detail]}
                imageSrc={serviceImages[index % serviceImages.length]}
                imageAlt={service.title}
                reverse={index % 2 === 1}
              >
                <div className="flex flex-wrap gap-3">
                  <Button href="/book" className="bg-[var(--ccr-accent-strong)] text-white hover:bg-[var(--ccr-accent)]">
                    Book This Service
                  </Button>
                  <Button href="/contact" variant="outline">
                    Ask a Question
                  </Button>
                </div>
              </PublicStoryBlock>
            </div>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Planning Made Simple"
        title="Need help choosing the right service for your stay?"
        description="From airport pickup to longer rentals, our team can guide you toward the setup that best fits your itinerary."
        primaryAction={{ href: "/contact", label: "Contact Us" }}
        secondaryAction={{ href: "/book", label: "Book Now" }}
      />
    </>
  );
}

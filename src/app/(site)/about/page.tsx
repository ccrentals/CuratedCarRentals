import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { PublicStoryBlock } from "@/components/site/PublicStoryBlock";
import { aboutFeatures, siteContent } from "@/data/content";

export default function AboutPage() {
  return (
    <>
      <PublicPageIntro
        eyebrow="About"
        title="About Us"
        description={siteContent.aboutIntro}
        primaryAction={{ href: "/fleet", label: "Explore Fleet" }}
        secondaryAction={{ href: "/book", label: "Book Now" }}
      />

      <PublicSection className="pt-12 md:pt-16">
        <PublicStoryBlock
          eyebrow="About Us"
          title={siteContent.aboutHeading}
          paragraphs={[siteContent.aboutDescription, siteContent.aboutSupport]}
          imageSrc="/cars/real/nissan-xtrail-3.jpg"
          imageAlt="Curated Car Rentals vehicle ready for a Jamaica adventure"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {aboutFeatures.slice(0, 4).map((feature) => (
              <article
                key={feature.title}
                className="rounded-[1.5rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
              >
                <p className="text-base font-semibold text-[var(--ccr-text)]">{feature.title}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ccr-muted)]">{feature.description}</p>
              </article>
            ))}
          </div>
        </PublicStoryBlock>
      </PublicSection>

      <PublicSection
        eyebrow="Our Mission"
        title="A seamless, stress-free transportation experience across Jamaica."
        description="We focus on personalized service, transparency, and quality so every rental supports the trip you came to have."
        className="bg-[var(--ccr-surface)]/55"
      >
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4 text-base leading-7 text-[var(--ccr-muted)]">
            {siteContent.mission.slice(0, 2).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              Local, attentive, dependable
            </p>
            <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">{siteContent.mission[2]}</p>
            <div className="mt-6 space-y-3 rounded-[1.5rem] bg-[var(--ccr-surface-soft)] p-5">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">{siteContent.address}</p>
              <p className="text-sm text-[var(--ccr-muted)]">{siteContent.phones[0]?.label}</p>
              <p className="text-sm text-[var(--ccr-muted)]">{siteContent.email}</p>
            </div>
          </article>
        </div>
      </PublicSection>

      <PublicSection
        eyebrow="Why Guests Choose Us"
        title="Built around confidence, comfort, and island know-how."
        description="Every part of the experience is shaped to make the vehicle side of your trip feel polished and reliable."
      >
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {aboutFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[1.7rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <p className="text-lg font-semibold text-[var(--ccr-text)]">{feature.title}</p>
              <p className="mt-3 text-sm leading-7 text-[var(--ccr-muted)]">{feature.description}</p>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Your Jamaica Journey"
        title="Ready to travel with a team that understands the island?"
        description="Browse the fleet, review the policies, and reserve a vehicle backed by local expertise and responsive support."
        primaryAction={{ href: "/fleet", label: "Explore Fleet" }}
        secondaryAction={{ href: "/rental-policies", label: "Rental Policies" }}
      />
    </>
  );
}

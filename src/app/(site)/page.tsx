import Link from "next/link";

import { HomeFeaturedCollection } from "@/components/sections/HomeFeaturedCollection";
import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicSection } from "@/components/site/PublicSection";
import { PublicStoryBlock } from "@/components/site/PublicStoryBlock";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import {
  aboutFeatures,
  reassuranceItems,
  siteContent,
  testimonials,
} from "@/data/content";
import { services } from "@/data/services";
import { getPublicVehicles } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const vehicles = await getPublicVehicles();
  const explicitlyFeaturedVehicles = vehicles.filter((vehicle) => vehicle.featured);
  const fallbackVehicles = vehicles.filter((vehicle) => !vehicle.featured);
  const featuredVehicles = [...explicitlyFeaturedVehicles, ...fallbackVehicles].slice(0, 5);

  return (
    <div className="pb-6">
      <section
        className="relative overflow-hidden border-b border-[var(--ccr-border)] text-white"
        style={{
          backgroundImage:
            "linear-gradient(110deg, rgba(6,10,18,0.88), rgba(10,16,28,0.56)), url('/cars/real/nissan-xtrail-2.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,207,109,0.18),transparent_28%)]" />
        <Container className="relative py-16 md:py-24 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-end">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--ccr-accent)]">
                {siteContent.location}
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-6xl">
                {siteContent.heroHeadline}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/80 md:text-lg">
                {siteContent.heroDescription}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/fleet" className="bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd588]">
                  Explore Our Fleet
                </Button>
                <Button
                  href="/book"
                  variant="outline"
                  className="border-white/20 bg-white/6 text-white hover:bg-white/12"
                >
                  Book Your Vehicle
                </Button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {aboutFeatures.slice(0, 3).map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-[1.5rem] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur-sm"
                  >
                    <p className="text-sm font-semibold text-white">{feature.title}</p>
                    <p className="mt-2 text-sm leading-6 text-white/68">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <article className="rounded-[2rem] border border-white/12 bg-[rgba(10,16,28,0.68)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.25)] backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
                  Transparent travel
                </p>
                <p className="mt-4 text-2xl font-semibold leading-tight text-white">
                  {siteContent.heroPricingNote}
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {reassuranceItems.slice(0, 2).map((item) => (
                    <div key={item.title} className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-white/68">{item.description}</p>
                    </div>
                  ))}
                </div>
              </article>

              <div className="grid gap-4 sm:grid-cols-2">
                <article className="rounded-[1.7rem] border border-white/12 bg-[rgba(10,16,28,0.62)] p-5 backdrop-blur-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                    Contact
                  </p>
                  <p className="mt-3 text-lg font-semibold text-white">{siteContent.phones[0]?.label}</p>
                  <p className="mt-1 text-sm text-white/68">{siteContent.email}</p>
                </article>

                <article className="rounded-[1.7rem] border border-white/12 bg-[rgba(10,16,28,0.62)] p-5 backdrop-blur-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                    Curated collection
                  </p>
                  <p className="mt-3 text-lg font-semibold text-white">
                    {vehicles.length} vehicles currently published
                  </p>
                  <p className="mt-1 text-sm text-white/68">
                    Browse the live fleet and book the vehicle that matches your route, pace, and travel plans.
                  </p>
                </article>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        <Container className="py-4">
          <p className="text-sm font-medium text-[var(--ccr-text)]">
            <span className="font-semibold text-[var(--ccr-accent-strong)]">Simple pricing</span>{" "}
            includes all fees and taxes. Optional insurance remains separate when selected.
          </p>
        </Container>
      </div>

      <HomeFeaturedCollection featuredVehicles={featuredVehicles} vehicleCount={vehicles.length} />

      <PublicSection className="bg-[var(--ccr-surface)]/55">
        <PublicStoryBlock
          eyebrow="About Us"
          title={siteContent.aboutHeading}
          paragraphs={[siteContent.aboutDescription, siteContent.aboutSupport]}
          imageSrc="/cars/real/honda-fit-2020-2.jpg"
          imageAlt="Curated Car Rentals vehicle prepared for Kingston travel"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {aboutFeatures.map((feature) => (
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
        eyebrow="Services"
        title="Support that goes beyond handing over the keys."
        description="Curated Car Rentals offers premium services designed to make your Jamaican journey feel easy from arrival to return."
      >
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {services.map((service) => (
            <article
              key={service.id}
              className="flex h-full flex-col rounded-[1.7rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                {service.title}
              </p>
              <p className="mt-4 text-sm leading-7 text-[var(--ccr-muted)]">{service.description}</p>
              <Link
                href={`/services#${service.id}`}
                className="mt-auto pt-6 text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
              >
                Learn more
              </Link>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicSection
        eyebrow="Customer Experience"
        title="What Our Customers Say"
        description="Discover why travelers choose Curated Car Rentals for their Jamaican adventures."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {testimonials.map((testimonial) => (
            <article
              key={testimonial.name}
              className="rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <div className="flex gap-1 text-[var(--ccr-accent)]" aria-hidden="true">
                <span>★</span>
                <span>★</span>
                <span>★</span>
                <span>★</span>
                <span>★</span>
              </div>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">“{testimonial.quote}”</p>
              <div className="mt-6">
                <p className="font-semibold text-[var(--ccr-text)]">{testimonial.name}</p>
                <p className="text-sm text-[var(--ccr-muted)]">{testimonial.location}</p>
              </div>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Book Your Vehicle"
        title="Ready to start planning your Jamaica drive?"
        description="Browse the live fleet, review the rental policies, and reserve the vehicle that fits your stay."
        primaryAction={{ href: "/book", label: "Book Your Vehicle" }}
        secondaryAction={{ href: "/fleet", label: "Explore Fleet" }}
      />
    </div>
  );
}

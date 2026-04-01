import Image from "next/image";

import { HomeFeaturedCollection } from "@/components/sections/HomeFeaturedCollection";
import { HomeBookingSection } from "@/components/site/HomeBookingSection";
import { HomeContactSection } from "@/components/site/HomeContactSection";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import {
  aboutFeatures,
  siteContent,
  testimonials,
} from "@/data/content";
import { getPublicVehicles } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const vehicles = await getPublicVehicles();
  const explicitlyFeaturedVehicles = vehicles.filter((vehicle) => vehicle.featured);
  const fallbackVehicles = vehicles.filter((vehicle) => !vehicle.featured);
  const featuredVehicles = [...explicitlyFeaturedVehicles, ...fallbackVehicles].slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden bg-[#0a1323] text-white">
        <div className="absolute inset-0">
          <Image
            src="/live-site/home/hero-tropical-car.jpg"
            alt="Modern car driving down a palm tree lined coastal road in Jamaica"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,74,78,0.4),rgba(22,54,96,0.28),rgba(234,114,66,0.22))]" />
        </div>

        <Container className="relative flex min-h-[calc(100svh-5.5rem)] items-center py-16 md:py-20 min-[1160px]:pt-44 lg:min-h-[calc(100svh-6rem)]">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full bg-[rgba(39,117,95,0.82)] px-4 py-2 text-sm font-medium text-white shadow-[0_18px_34px_rgba(0,0,0,0.18)] backdrop-blur-sm">
              <span className="mr-2">🌴</span> Kingston, Jamaica
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl lg:text-6xl">
              {siteContent.heroHeadline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/90">
              {siteContent.heroDescription}
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Button
                href="/book"
                className="rounded-full bg-[#ea7242] px-6 py-3 text-white shadow-lg hover:bg-[#ef8257]"
              >
                Book Your Vehicle
              </Button>
              <Button
                href="/fleet"
                variant="outline"
                className="rounded-full border-white/18 bg-[var(--ccr-primary)]/88 px-6 py-3 text-[var(--ccr-on-primary)] hover:bg-[var(--ccr-primary)]"
              >
                Explore Our Fleet
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-b border-[var(--ccr-border)] bg-[#f7e0b0] py-4 text-center">
        <Container>
          <p className="text-sm font-medium text-[#4c3b16] md:text-base">
            🌺 Our Simple Pricing includes all fees and taxes - No Surprises!{" "}
            <span className="text-[#7a6230]">(*optional insurance is extra)</span>
          </p>
        </Container>
      </section>

      <HomeFeaturedCollection featuredVehicles={featuredVehicles} vehicleCount={vehicles.length} />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ccr-bg),var(--ccr-surface))] py-16 md:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div className="overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="relative h-[24rem] md:h-[30rem]">
                <Image
                  src="/live-site/home/discover-jamaica.png"
                  alt="Exploring Jamaica with Curated Car Rentals"
                  fill
                  sizes="(min-width: 1024px) 42vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="border-t border-[var(--ccr-border)] p-6">
                <h3 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                  Discover Jamaica
                </h3>
                <p className="mt-3 text-base leading-7 text-[var(--ccr-muted)]">
                  From Kingston&apos;s vibrant streets to stunning coastal drives, our vehicles are your passport to Jamaica&apos;s wonders.
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                About Us
              </p>
              <h2 className="mt-4 font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
                {siteContent.aboutHeading}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[var(--ccr-muted)]">
                {siteContent.aboutDescription}
              </p>
              <p className="mt-4 text-lg leading-8 text-[var(--ccr-muted)]">
                {siteContent.aboutSupport}
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {aboutFeatures.map((feature) => (
                  <article
                    key={feature.title}
                    className="rounded-[1.4rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.05)]"
                  >
                    <h3 className="text-lg font-semibold text-[var(--ccr-text)]">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-[var(--ccr-muted)]">{feature.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </section>

      <HomeBookingSection />

      <section className="relative overflow-hidden bg-[linear-gradient(135deg,var(--ccr-primary-soft),var(--ccr-primary))] py-16 text-[var(--ccr-on-primary)] md:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-16">
          <svg
            viewBox="0 0 1440 120"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="presentation"
          >
            <path
              d="M0 30C132 52 262 58 386 54C522 50 638 20 776 24C944 29 1084 70 1230 74C1314 76 1386 68 1440 58V0H0V30Z"
              fill="var(--ccr-surface-soft)"
              opacity="0.22"
            />
            <path
              d="M0 54C122 50 222 74 342 82C478 92 620 62 758 64C922 66 1040 96 1198 100C1284 102 1364 94 1440 82V120H0V54Z"
              fill="var(--ccr-accent)"
              opacity="0.1"
            />
          </svg>
        </div>
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-4xl font-bold text-[var(--ccr-on-primary)] md:text-5xl">
              What Our Customers Say
            </h2>
            <p className="mt-4 text-lg leading-8 text-[var(--ccr-on-primary-muted)]">
              Discover why travelers choose Curated Car Rentals for their Jamaican adventures.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {testimonials.map((testimonial) => (
              <article
                key={testimonial.name}
                className="rounded-[2rem] border border-white/12 bg-white/8 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm"
              >
                <div className="flex items-center gap-4">
                  <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-white/12">
                    <Image
                      src={testimonial.avatar}
                      alt={testimonial.name}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex gap-1 text-[#f5d277]" aria-hidden="true">
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                  </div>
                </div>

                <p className="mt-5 text-lg leading-8 text-white/88">
                  &quot;{testimonial.quote}&quot;
                </p>

                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-white">{testimonial.name}</h3>
                  <p className="text-sm text-white/66">{testimonial.location}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <HomeContactSection />
    </>
  );
}

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

        <Container className="relative flex min-h-[calc(100svh-4.9rem)] items-center py-12 sm:py-14 md:py-20 min-[1160px]:pt-44 lg:min-h-[calc(100svh-6rem)]">
          <div className="max-w-3xl min-[1160px]:translate-y-4">
            <div className="inline-flex items-center rounded-full bg-[rgba(39,117,95,0.82)] px-3.5 py-2 text-xs font-medium text-white shadow-[0_18px_34px_rgba(0,0,0,0.18)] backdrop-blur-sm sm:px-4 sm:text-sm">
              <span className="mr-2">🌴</span> Kingston, Jamaica
            </div>

            <h1 className="mt-5 max-w-[34rem] text-[2.45rem] font-semibold leading-[1.02] text-white sm:mt-6 sm:text-[3rem] md:text-5xl lg:text-6xl">
              {siteContent.heroHeadline}
            </h1>
            <p className="mt-5 max-w-[32rem] text-base leading-7 text-white/90 sm:mt-6 sm:text-lg sm:leading-8">
              {siteContent.heroDescription}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:gap-4">
              <Button
                href="/book"
                className="w-full rounded-full bg-[#ea7242] px-6 py-3 text-white shadow-lg hover:bg-[#ef8257] sm:w-auto"
              >
                Book Your Vehicle
              </Button>
              <Button
                href="/fleet"
                variant="outline"
                className="w-full rounded-full !border-white/24 bg-[var(--ccr-primary)]/78 px-6 py-3 !text-white backdrop-blur-[2px] hover:bg-[var(--ccr-primary)]/88 sm:w-auto"
              >
                Explore Our Fleet
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-b border-[var(--ccr-border)] bg-[#f7e0b0] py-3 text-center sm:py-4">
        <Container>
          <p className="text-[13px] font-medium leading-6 text-[#4c3b16] sm:text-sm md:text-base">
            🌺 Our Simple Pricing includes all fees and taxes - No Surprises!{" "}
            <span className="text-[#7a6230]">(*optional insurance is extra)</span>
          </p>
        </Container>
      </section>

      <HomeFeaturedCollection featuredVehicles={featuredVehicles} vehicleCount={vehicles.length} />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ccr-bg),var(--ccr-surface))] py-12 sm:py-14 md:py-24">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-10">
            <div className="overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="relative h-[18rem] sm:h-[21rem] md:h-[30rem]">
                <Image
                  src="/live-site/home/discover-jamaica.png"
                  alt="Exploring Jamaica with Curated Car Rentals"
                  fill
                  sizes="(min-width: 1024px) 42vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="border-t border-[var(--ccr-border)] p-5 sm:p-6">
                <h3 className="font-display text-[1.75rem] font-bold text-[var(--ccr-text)] sm:text-2xl">
                  Discover Jamaica
                </h3>
                <p className="mt-3 text-[0.98rem] leading-7 text-[var(--ccr-muted)] sm:text-base">
                  From Kingston&apos;s vibrant streets to stunning coastal drives, our vehicles are your passport to Jamaica&apos;s wonders.
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                About Us
              </p>
              <h2 className="mt-4 font-display text-[2rem] font-bold leading-tight text-[var(--ccr-text)] sm:text-[2.4rem] md:text-5xl">
                {siteContent.aboutHeading}
              </h2>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)] sm:mt-5 sm:text-lg sm:leading-8">
                {siteContent.aboutDescription}
              </p>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)] sm:text-lg sm:leading-8">
                {siteContent.aboutSupport}
              </p>

              <div className="mt-7 grid gap-3 sm:mt-8 sm:gap-4 md:grid-cols-2">
                {aboutFeatures.map((feature) => (
                  <article
                    key={feature.title}
                    className="rounded-[1.4rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-[0_14px_36px_rgba(15,23,42,0.05)] sm:p-5"
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

      <section className="relative overflow-hidden bg-[linear-gradient(135deg,var(--ccr-primary-soft),var(--ccr-primary))] py-12 text-[var(--ccr-on-primary)] sm:py-14 md:py-24">
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
            <h2 className="font-display text-[2rem] font-bold leading-tight text-[var(--ccr-on-primary)] sm:text-[2.4rem] md:text-5xl">
              What Our Customers Say
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--ccr-on-primary-muted)] sm:text-lg sm:leading-8">
              Discover why travelers choose Curated Car Rentals for their Jamaican adventures.
            </p>
          </div>

          <div className="mt-8 grid gap-5 sm:mt-10 sm:gap-6 lg:grid-cols-3">
            {testimonials.map((testimonial) => (
              <article
                key={testimonial.name}
                className="rounded-[2rem] border border-white/12 bg-white/8 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm sm:p-6"
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

                <p className="mt-4 text-base leading-7 text-white/88 sm:mt-5 sm:text-lg sm:leading-8">
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

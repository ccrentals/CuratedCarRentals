import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { aboutFeatures, siteContent } from "@/data/content";

export default function AboutPage() {
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
            >
              <span aria-hidden="true">←</span>
              <span>Back to home</span>
            </Link>

            <h1 className="mt-5 font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              About Us
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--ccr-muted)]">
              {siteContent.aboutIntro}
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
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
              <h2 className="mt-4 font-display text-4xl font-bold text-[var(--ccr-light-surface-text)] md:text-5xl">
                {siteContent.aboutHeading}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[var(--ccr-light-surface-muted)]">
                {siteContent.aboutDescription}
              </p>
              <p className="mt-4 text-lg leading-8 text-[var(--ccr-light-surface-muted)]">
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

      <section className="bg-[var(--ccr-surface-soft)]/55 py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              Our Mission
            </h2>
            <p className="mt-6 text-lg leading-8 text-[var(--ccr-muted)]">{siteContent.mission[0]}</p>
            <p className="mt-5 text-lg leading-8 text-[var(--ccr-muted)]">{siteContent.mission[1]}</p>
          </div>
        </Container>
      </section>
    </>
  );
}

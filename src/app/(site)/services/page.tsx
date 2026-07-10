import Image from "next/image";

import { JsonLd } from "@/components/seo/JsonLd";
import { Container } from "@/components/site/Container";
import { loadLandingContent } from "@/lib/landingContent";
import { publicPageMetadata } from "@/lib/seo";
import {
  breadcrumbStructuredData,
  servicesStructuredData,
} from "@/lib/structuredData";

export const metadata = publicPageMetadata({
  title: "Car Rental Services in Jamaica",
  description:
    "Explore airport pickup, chauffeur service, wedding vehicle packages, corporate rentals, and long-term car rental services in Jamaica.",
  path: "/services",
});

export default async function ServicesPage() {
  const { content } = await loadLandingContent();
  const page = content.services;
  return (
    <>
      <JsonLd
        data={[
          servicesStructuredData(page.items),
          breadcrumbStructuredData([
            { name: "Home", path: "/" },
            { name: page.title, path: "/services" },
          ]),
        ]}
      />
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
              {page.description}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {page.items.map((service) => (
              <a
                key={service.id}
                href={`#${service.id}`}
                className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-medium text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface-soft)]"
              >
                {service.title}
              </a>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="space-y-20">
            {page.items.map((service, index) => (
              <article
                key={service.id}
                id={service.id}
                className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center"
              >
                <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                  <div className="relative h-[24rem] overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:h-[28rem]">
                    <Image
                      src={service.imageSrc}
                      alt={service.imageAlt}
                      fill
                      sizes="(min-width: 1024px) 42vw, 100vw"
                      className="object-cover"
                      unoptimized={!service.imageSrc.startsWith("/")}
                    />
                  </div>
                </div>

                <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
                  <h2 className="font-display text-4xl font-bold text-[var(--ccr-light-surface-text)] md:text-5xl">
                    {service.title}
                  </h2>
                  <p className="mt-5 text-lg leading-8 text-[var(--ccr-light-surface-muted)]">{service.description}</p>

                  <a
                    href="/contact"
                    className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-[#2ea9f4] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#48b9fa]"
                  >
                    {page.serviceCtaLabel}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}

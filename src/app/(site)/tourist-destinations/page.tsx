import Image from "next/image";

import { Container } from "@/components/site/Container";
import { loadLandingContent } from "@/lib/landingContent";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Jamaica Tourist Destinations by Rental Car",
  description:
    "Plan Jamaica road trips from Kingston to beaches, waterfalls, mountains, historic sites, and scenic destinations with a rental vehicle.",
  path: "/tourist-destinations",
});

export default async function TouristDestinationsPage() {
  const { content } = await loadLandingContent();
  const page = content.touristDestinations;
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
            {page.title}
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
            {page.description}
          </p>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="mb-10 rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/55 p-6 md:p-8">
            <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
              {page.routeTitle}
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--ccr-muted)]">
              {page.routeDescription}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {page.items.map((destination) => (
              <article
                key={destination.name}
                className="overflow-hidden rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
              >
                <div className="relative h-64">
                  <Image
                    src={destination.imageSrc}
                    alt={destination.name}
                    fill
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover"
                    unoptimized={!destination.imageSrc.startsWith("/")}
                  />
                </div>
                <div className="p-6">
                  <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                    {destination.name}
                  </h2>
                  <p className="mt-2 text-sm font-medium text-[var(--ccr-muted)]">{destination.location}</p>
                  <p className="mt-4 text-base leading-8 text-[var(--ccr-muted)]">{destination.description}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}

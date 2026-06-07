import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/seo/JsonLd";
import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicSection } from "@/components/site/PublicSection";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { formatJmd, formatPublicJmd } from "@/lib/money";
import { getPublicVehicleByIdentifier } from "@/lib/publicVehicles";
import { publicPageMetadata } from "@/lib/seo";
import {
  breadcrumbStructuredData,
  vehicleStructuredData,
} from "@/lib/structuredData";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vehicle = await getPublicVehicleByIdentifier(id);

  if (!vehicle) {
    return {
      title: "Vehicle Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const image = vehicle.images.find((item) => item !== "/window.svg");
  return publicPageMetadata({
    title: `${vehicle.name} Rental in Jamaica`,
    description: `${vehicle.name} rental from Curated Car Rentals in Kingston, Jamaica. Review daily pricing, deposit, seats, luggage capacity, and booking details.`,
    path: `/fleet/${encodeURIComponent(vehicle.slug || vehicle.id)}`,
    image,
  });
}

export default async function FleetVehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vehicle = await getPublicVehicleByIdentifier(id);

  if (!vehicle) {
    notFound();
  }

  const detailSpecs = [
    { label: "Transmission", value: vehicle.transmission },
    { label: "Passengers", value: `${vehicle.seats} Seats` },
    { label: "Luggage", value: `${vehicle.bags} Bags` },
    { label: "Doors", value: `${vehicle.doors} Doors` },
    { label: "Fuel policy", value: vehicle.fuelPolicy },
    { label: "Mileage", value: vehicle.mileagePolicy },
  ];

  const comfortItems = [
    { label: "Air conditioning", value: vehicle.airConditioning ? "Included" : "Not listed" },
    { label: "Drivetrain", value: vehicle.drivetrain || "Standard drive" },
    { label: "Hybrid", value: vehicle.hybrid ? "Yes" : "No" },
    { label: "Category", value: vehicle.category },
  ];
  const headlineMeta = [vehicle.category, String(vehicle.year)].filter(Boolean).join(" • ");
  const heroImage = vehicle.images[0] ?? "/window.svg";
  const unoptimizedHeroImage = !heroImage.startsWith("/");

  return (
    <div className="pb-6">
      <JsonLd
        data={[
          vehicleStructuredData(vehicle),
          breadcrumbStructuredData([
            { name: "Home", path: "/" },
            { name: "Fleet", path: "/fleet" },
            { name: vehicle.name, path: `/fleet/${vehicle.slug || vehicle.id}` },
          ]),
        ]}
      />
      <section className="relative overflow-hidden border-b border-[var(--ccr-border)] bg-[var(--ccr-primary)] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(255,207,109,0.18),transparent_32%)]" />
        <Container className="relative py-8 sm:py-10 md:py-16">
          <Link
            href="/fleet"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white/72 transition hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Fleet
          </Link>

          <div className="mt-5 grid gap-7 sm:mt-6 sm:gap-8 xl:grid-cols-[1.08fr_0.92fr] xl:items-start xl:gap-10">
            <div>
              <div className="relative h-[280px] overflow-hidden rounded-[2rem] border border-white/10 bg-black/10 shadow-[0_30px_90px_rgba(0,0,0,0.24)] sm:h-[320px] md:h-[460px]">
                <Image
                  src={heroImage}
                  alt={vehicle.name}
                  fill
                  sizes="(min-width: 1280px) 54vw, 100vw"
                  className="object-cover"
                  unoptimized={unoptimizedHeroImage}
                />
              </div>

              {vehicle.images.length > 1 ? (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-3">
                  {vehicle.images.slice(0, 3).map((image, index) => (
                    <div
                      key={`${image}-${index}`}
                      className="relative h-24 overflow-hidden rounded-[1.2rem] border border-white/10 bg-black/10 sm:h-28 sm:rounded-[1.4rem] md:h-36"
                    >
                      <Image
                        src={image}
                        alt={`${vehicle.name} detail ${index + 1}`}
                        fill
                        sizes="(min-width: 768px) 18vw, 30vw"
                        className="object-cover"
                        unoptimized={!image.startsWith("/")}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="xl:sticky xl:top-24">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">{headlineMeta}</p>
              <h1 className="mt-4 text-[2.35rem] font-semibold leading-[1.04] tracking-tight sm:text-4xl md:text-5xl">{vehicle.name}</h1>
              <p className="mt-4 max-w-xl text-[0.98rem] leading-7 text-white/76 sm:mt-5 sm:text-base">{vehicle.description}</p>

              <div className="mt-5 flex flex-wrap gap-2 text-sm text-white/72 sm:mt-6">
                <div className="min-w-[8.5rem] flex-1 rounded-full border border-white/12 bg-white/6 px-3 py-2.5 text-center">
                  {vehicle.transmission}
                </div>
                <div className="min-w-[8.5rem] flex-1 rounded-full border border-white/12 bg-white/6 px-3 py-2.5 text-center">
                  {vehicle.seats} Seats
                </div>
                <div className="min-w-[8.5rem] flex-1 rounded-full border border-white/12 bg-white/6 px-3 py-2.5 text-center">
                  {vehicle.bags} Bags
                </div>
              </div>

              <div className="mt-7 rounded-[1.9rem] border border-white/12 bg-white/7 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:mt-8 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
                  Pricing
                </p>
                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[2rem] font-semibold sm:text-3xl">{formatPublicJmd(vehicle.pricePerDay)}</p>
                    <p className="mt-1 text-sm text-white/68">per day</p>
                  </div>
                  {vehicle.deposit_cents > 0 ? (
                    <div className="sm:text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/52">Deposit</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatJmd(vehicle.deposit_cents)}</p>
                    </div>
                  ) : null}
                </div>
                <p className="mt-5 text-sm leading-7 text-white/70">{siteContent.heroPricingNote}</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button href={`/book?vehicle=${vehicle.id}`} className="w-full bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd588] sm:w-auto">
                    Reserve This Car
                  </Button>
                  <Button
                    href="/rental-policies"
                    variant="outline"
                    className="w-full border-white/20 bg-white/6 text-white hover:bg-white/12 sm:w-auto"
                  >
                    Rental Policies
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <PublicSection
        eyebrow="Vehicle Details"
        title="Comfort, practicality, and clear rental information."
        description="Everything below keeps the booking decision simple while preserving the live vehicle data from the backend."
      >
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {detailSpecs.map((item) => (
              <article
                key={item.label}
                className="rounded-[1.5rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-[0_14px_42px_rgba(15,23,42,0.05)] sm:p-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  {item.label}
                </p>
                <p className="mt-3 text-base font-semibold text-[var(--ccr-text)]">{item.value}</p>
              </article>
            ))}
          </div>

          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_56px_rgba(15,23,42,0.07)] sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              Comfort & Practicality
            </p>
            <div className="mt-5 space-y-4">
              {comfortItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 border-b border-[var(--ccr-border)] pb-4 last:border-b-0 last:pb-0">
                  <span className="text-sm text-[var(--ccr-muted)]">{item.label}</span>
                  <span className="text-sm font-semibold text-[var(--ccr-text)]">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[1.5rem] bg-[var(--ccr-surface-soft)] p-4 sm:p-5">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">Travel note</p>
              <p className="mt-2 text-sm leading-7 text-[var(--ccr-muted)]">
                For pricing, pickup details, and reservation guidance, continue to booking or review the rental policies before confirming your vehicle.
              </p>
            </div>
          </article>
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Continue Exploring"
        title="Want to compare this vehicle with the rest of the fleet?"
        description="Return to the full collection or move straight to booking when you're ready to secure your dates."
        primaryAction={{ href: "/fleet", label: "Back to Fleet" }}
        secondaryAction={{ href: `/book?vehicle=${vehicle.id}`, label: "Book This Vehicle" }}
      />
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { PublicSection } from "@/components/site/PublicSection";
import { Button } from "@/components/ui/Button";
import type { PublicVehicle } from "@/lib/publicVehicles";
import { formatCurrency } from "@/lib/utils";

type CollectionSupportIconName = "fleet" | "booking" | "policy" | "guide";

function CollectionSupportIcon({ icon }: { icon: CollectionSupportIconName }) {
  if (icon === "fleet") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6.5h16" strokeLinecap="round" />
        <path d="M4 12h16" strokeLinecap="round" />
        <path d="M4 17.5h10" strokeLinecap="round" />
        <circle cx="18" cy="17.5" r="2" />
      </svg>
    );
  }

  if (icon === "booking") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3.5v3" strokeLinecap="round" />
        <path d="M17 3.5v3" strokeLinecap="round" />
        <rect x="4" y="6.5" width="16" height="13" rx="2.5" />
        <path d="M4 10.5h16" />
        <path d="M9 14h2" strokeLinecap="round" />
        <path d="M13 14h2" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "policy") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 4.5h7l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
        <path d="M15 4.5v4h4" />
        <path d="M9 13h6" strokeLinecap="round" />
        <path d="M9 17h4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20.5c4.4 0 8-3.6 8-8s-3.6-8-8-8-8 3.6-8 8 3.6 8 8 8Z" />
      <path d="M12 8.5v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AdminActionArrow({
  shellClassName,
  iconClassName,
}: {
  shellClassName?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${shellClassName ?? ""}`.trim()}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 20 20"
        className={`h-3.5 w-3.5 -rotate-90 ${iconClassName ?? ""}`.trim()}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 7l5 6 5-6" />
      </svg>
    </span>
  );
}

type HomeFeaturedCollectionProps = {
  featuredVehicles: PublicVehicle[];
  vehicleCount: number;
};

export function HomeFeaturedCollection({
  featuredVehicles,
  vehicleCount,
}: HomeFeaturedCollectionProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState(featuredVehicles[0]?.id ?? "");
  const selectedVehicle =
    featuredVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? featuredVehicles[0];
  const collectionVehicles = featuredVehicles.filter((vehicle) => vehicle.id !== selectedVehicle?.id).slice(0, 4);
  const collectionSupportTiles = [
    {
      icon: "fleet" as const,
      eyebrow: "Entire fleet",
      title: "See every published vehicle",
      description: `${vehicleCount} live vehicles remain connected to the homepage and fleet pages.`,
      href: "/fleet",
      actionLabel: "Explore fleet",
    },
    {
      icon: "booking" as const,
      eyebrow: "Direct booking",
      title: "Start a reservation in minutes",
      description: "Go straight into the booking flow with the same live vehicle data and pricing structure.",
      href: "/book",
      actionLabel: "Book now",
    },
    {
      icon: "policy" as const,
      eyebrow: "Rental policies",
      title: "Review the booking essentials",
      description: "Check the ID, deposit, and reservation guidance before locking in your dates.",
      href: "/rental-policies",
      actionLabel: "Read policies",
    },
    {
      icon: "guide" as const,
      eyebrow: "Driving guide",
      title: "Plan confidently for Jamaica",
      description: "Helpful road guidance for visitors navigating Kingston and beyond with ease.",
      href: "/driving-in-jamaica",
      actionLabel: "View guide",
    },
  ];
  const collectionTiles = [
    ...collectionVehicles.map((vehicle) => ({ type: "vehicle" as const, vehicle })),
    ...collectionSupportTiles.map((tile) => ({ type: "support" as const, ...tile })),
  ].slice(0, 4);

  return (
    <PublicSection
      eyebrow="Our Curated Collection"
      title="Premium vehicles chosen for comfort, style, and reliability."
      description="Discover our handpicked selection of vehicles for business trips, holiday stays, and island drives."
    >
      <div className="mb-10 flex flex-col gap-5 border-b border-[var(--ccr-border)] pb-6 md:flex-row md:items-end md:justify-between">
        <p className="max-w-2xl text-sm leading-7 text-[var(--ccr-muted)] md:text-[15px]">
          Featured vehicles stay backend-fed from the live fleet, so the homepage always reflects what is currently published.
        </p>
        <Link
          href="/fleet"
          className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ccr-text)] shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:text-[var(--ccr-accent-strong)]"
        >
          View our entire fleet
          <AdminActionArrow shellClassName="border-[var(--ccr-border)] text-[var(--ccr-text)]" />
        </Link>
      </div>

      {selectedVehicle ? (
        <div className="space-y-5">
          <article className="relative overflow-hidden rounded-[2.4rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] shadow-[0_32px_80px_rgba(15,23,42,0.12)]">
            <div className="relative min-h-[22rem] sm:min-h-[26rem] lg:min-h-[31rem]">
              <Image
                src={selectedVehicle.images[0] ?? "/window.svg"}
                alt={selectedVehicle.name}
                fill
                sizes="100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,22,0.14),rgba(7,12,22,0.52))]" />

              <div className="absolute left-5 top-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/16 bg-white/84 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--ccr-primary)] shadow-[0_12px_28px_rgba(15,23,42,0.14)] backdrop-blur-sm">
                  {selectedVehicle.category}
                </span>
                {selectedVehicle.year ? (
                  <span className="rounded-full border border-white/16 bg-[rgba(255,255,255,0.72)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--ccr-accent-strong)] shadow-[0_12px_28px_rgba(15,23,42,0.14)] backdrop-blur-sm">
                    {selectedVehicle.year}
                  </span>
                ) : null}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <div className="grid gap-4 rounded-[1.9rem] border border-white/12 bg-[rgba(8,15,30,0.62)] p-5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.2)] backdrop-blur-md lg:grid-cols-[1.1fr_auto] lg:items-end lg:gap-8">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/72">
                      Main stage
                    </p>
                    <h3 className="mt-3 max-w-[11ch] text-[2.15rem] font-semibold leading-[0.98] tracking-[-0.05em] text-white sm:text-[2.85rem]">
                      {selectedVehicle.name}
                    </h3>
                    <p className="mt-3 max-w-[34ch] text-sm leading-7 text-white/76 sm:text-base">
                      {selectedVehicle.description}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2.5">
                      <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/76">
                        {selectedVehicle.transmission}
                      </span>
                      <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/76">
                        {selectedVehicle.seats} Seats
                      </span>
                      <span className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/76">
                        {selectedVehicle.bags} Bags
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 lg:items-end">
                    <div className="rounded-[1.6rem] border border-white/12 bg-[rgba(7,12,22,0.54)] px-5 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.16)]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/66">From</p>
                      <p className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-white">
                        {formatCurrency(selectedVehicle.pricePerDay)}
                      </p>
                      <p className="text-sm text-white/68">per day</p>
                    </div>

                    <div className="flex flex-wrap gap-3 lg:justify-end">
                      <Link
                        href={`/fleet/${selectedVehicle.slug ?? selectedVehicle.id}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[rgba(255,255,255,0.1)]"
                      >
                        View details
                        <AdminActionArrow shellClassName="border-white/12 text-white" />
                      </Link>
                      <Button
                        href={`/book?vehicle=${selectedVehicle.id}`}
                        className="rounded-full bg-[var(--ccr-accent-strong)] px-5 text-white shadow-[0_16px_34px_rgba(15,23,42,0.2)] hover:bg-[var(--ccr-accent)]"
                      >
                        Reserve This Car
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {collectionTiles.map((tile, index) => {
              if (tile.type === "vehicle") {
                const isSelected = tile.vehicle.id === selectedVehicle.id;

                return (
                  <article
                    key={tile.vehicle.id}
                    className={`flex h-full flex-col overflow-hidden rounded-[1.8rem] border bg-[var(--ccr-surface)] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] transition ${
                      isSelected
                        ? "border-[var(--ccr-accent-strong)] shadow-[0_20px_44px_rgba(15,23,42,0.14)]"
                        : "border-[var(--ccr-border)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedVehicleId(tile.vehicle.id)}
                      aria-pressed={isSelected}
                      className="flex flex-1 flex-col text-left"
                    >
                      <div className="relative h-36 overflow-hidden rounded-[1.35rem] bg-[var(--ccr-surface-soft)]">
                        <Image
                          src={tile.vehicle.images[0] ?? "/window.svg"}
                          alt={tile.vehicle.name}
                          fill
                          sizes="(min-width: 1024px) 21vw, (min-width: 768px) 46vw, 100vw"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,16,28,0.02),rgba(10,16,28,0.2))]" />
                        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-primary)]">
                            {tile.vehicle.category}
                          </span>
                          {tile.vehicle.year ? (
                            <span className="rounded-full bg-[rgba(255,255,255,0.76)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                              {tile.vehicle.year}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-1 flex-col">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-muted)]">
                            Module {index + 1}
                          </p>
                          {isSelected ? (
                            <span className="rounded-full border border-[var(--ccr-accent-strong)] bg-[var(--ccr-surface-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                              Selected
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-3 text-[1.55rem] font-semibold leading-[1.02] tracking-[-0.04em] text-[var(--ccr-text)]">
                          {tile.vehicle.name}
                        </h3>
                        <p className="mt-3 min-h-[4.5rem] text-sm leading-6 text-[var(--ccr-muted)]">
                          {tile.vehicle.description}
                        </p>

                        <div className="mt-4 mb-3 flex flex-wrap gap-2 text-xs font-medium text-[var(--ccr-muted)]">
                          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2">
                            {tile.vehicle.transmission}
                          </span>
                          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2">
                            {tile.vehicle.seats} Seats
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="mt-auto border-t border-[var(--ccr-border)] pt-5">
                      <Link
                        href={`/fleet/${tile.vehicle.slug ?? tile.vehicle.id}`}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
                      >
                        View details
                        <AdminActionArrow shellClassName="border-[var(--ccr-border)] text-[var(--ccr-text)]" />
                      </Link>
                    </div>
                  </article>
                );
              }

              return (
                <article
                  key={tile.title}
                  className="flex h-full flex-col rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                >
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-primary)]">
                    <CollectionSupportIcon icon={tile.icon} />
                  </div>
                  <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-muted)]">
                    {tile.eyebrow}
                  </p>
                  <h3 className="mt-3 text-[1.45rem] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--ccr-text)]">
                    {tile.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--ccr-muted)]">{tile.description}</p>

                  <Link
                    href={tile.href}
                    className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
                  >
                    {tile.actionLabel}
                    <AdminActionArrow shellClassName="border-[var(--ccr-border)] text-[var(--ccr-text)]" />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {collectionSupportTiles.map((tile) => (
            <article
              key={tile.title}
              className="flex h-full flex-col rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-primary)]">
                <CollectionSupportIcon icon={tile.icon} />
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-muted)]">
                {tile.eyebrow}
              </p>
              <h3 className="mt-3 text-[1.45rem] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--ccr-text)]">
                {tile.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[var(--ccr-muted)]">{tile.description}</p>

              <Link
                href={tile.href}
                className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
              >
                {tile.actionLabel}
                <AdminActionArrow shellClassName="border-[var(--ccr-border)] text-[var(--ccr-text)]" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </PublicSection>
  );
}

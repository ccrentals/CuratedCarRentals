import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { PublicSection } from "@/components/site/PublicSection";
import { buttonStyles } from "@/components/ui/Button";
import type { PublicVehicle } from "@/lib/publicVehicles";
import { formatPublicJmd } from "@/lib/money";

type HomeFeaturedCollectionProps = {
  featuredVehicles: PublicVehicle[];
  vehicleCount: number;
};

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PassengersIcon() {
  return (
    <IconBase>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <circle cx="9" cy="7" r="4" />
    </IconBase>
  );
}

function TransmissionIcon() {
  return (
    <IconBase>
      <path d="m14.5 16.5 2-2 2 2" />
      <path d="M16.5 14.5V8" />
      <path d="m9.5 8.5-2 2-2-2" />
      <path d="M7.5 10.5V17" />
      <path d="M12 6v12" />
      <circle cx="12" cy="6" r="2.25" />
      <circle cx="12" cy="18" r="2.25" />
    </IconBase>
  );
}

function FuelIcon() {
  return (
    <IconBase>
      <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-7a2 2 0 0 0-.59-1.41L18 5" />
      <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" />
      <path d="M3 21h12" />
      <path d="M3 9h11" />
    </IconBase>
  );
}

export function HomeFeaturedCollection({
  featuredVehicles,
  vehicleCount,
}: HomeFeaturedCollectionProps) {
  const collectionVehicles = featuredVehicles.slice(0, 3);

  return (
    <PublicSection
      eyebrow={undefined}
      title="Our Curated Collection"
      description="Discover our handpicked selection of premium vehicles that combine style, comfort, and reliability for your Jamaican adventure."
      className="bg-white"
    >
      <div className="grid gap-5 sm:gap-6 xl:grid-cols-3">
        {collectionVehicles.length === 0 ? (
          <article className="rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm leading-7 text-[var(--ccr-muted)] shadow-[0_18px_56px_rgba(15,23,42,0.08)] xl:col-span-3">
            No vehicles are currently published. Add and publish vehicles from the Admin portal.
          </article>
        ) : (
          collectionVehicles.map((vehicle) => {
            const displayYear = vehicle.year;
            const image = vehicle.images[0] ?? "/window.svg";
            const unoptimizedImage = !image.startsWith("/");

            return (
              <article
                key={vehicle.id}
                className="flex h-full flex-col overflow-hidden rounded-[1.85rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_18px_56px_rgba(15,23,42,0.08)]"
              >
                <div className="relative h-64 overflow-hidden bg-[var(--ccr-surface-soft)] sm:h-72">
                  <Image
                    src={image}
                    alt={vehicle.name}
                    fill
                    sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                    className="object-cover"
                    unoptimized={unoptimizedImage}
                  />
                  <div className="absolute left-4 top-4 flex gap-2">
                    <span className="rounded-full bg-[rgba(7,11,18,0.82)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                      {vehicle.category}
                    </span>
                    {displayYear ? (
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ccr-primary)]">
                        {displayYear}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-5 sm:gap-5 sm:p-6">
                  <div>
                    <div className="min-h-[4.2rem] sm:min-h-[4.8rem]">
                      <h3 className="font-display text-[1.6rem] font-bold leading-[1.12] text-[var(--ccr-text)] sm:text-[1.9rem]">
                        {vehicle.name}
                      </h3>
                    </div>
                    <div className="mt-2 text-sm text-[var(--ccr-muted)]">
                      <span className="text-[1.7rem] font-semibold leading-none text-[var(--ccr-text)] sm:text-[2rem]">{formatPublicJmd(vehicle.pricePerDay)}</span>{" "}
                      per day
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-2.5 text-sm text-[var(--ccr-muted)] sm:gap-x-6 sm:gap-y-3 sm:text-[1.05rem]">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-[var(--ccr-muted)]/90">
                        <PassengersIcon />
                      </span>
                      <span>{vehicle.seats} Passengers</span>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <span className="text-[var(--ccr-muted)]/90">
                        <TransmissionIcon />
                      </span>
                      <span>{vehicle.transmission}</span>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <span className="text-[var(--ccr-muted)]/90">
                        <FuelIcon />
                      </span>
                      <span>Gasoline</span>
                    </div>
                  </div>

                  <p className="text-sm leading-7 text-[var(--ccr-muted)]">
                    Our simple pricing includes all statutory fees and taxes - (only optional Insurance is extra)
                  </p>

                  <Link
                    href={`/book?vehicle=${vehicle.id}`}
                    className={buttonStyles({
                      variant: "primary",
                      size: "lg",
                      className: "mt-auto w-full justify-center self-start rounded-full sm:w-auto",
                    })}
                  >
                    Reserve Now
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="mt-7 flex justify-center sm:mt-8">
        <Link
          href="/fleet"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ccr-light-surface-text)] transition hover:text-[var(--ccr-accent-strong)]"
        >
          View our entire fleet
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4.5 10h11" strokeLinecap="round" />
            <path d="M11 5.5L15.5 10 11 14.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      <p className="mt-3 text-center text-sm text-[var(--ccr-light-surface-muted)] sm:mt-4">
        Showing {collectionVehicles.length} of {vehicleCount} published vehicles.
      </p>
    </PublicSection>
  );
}

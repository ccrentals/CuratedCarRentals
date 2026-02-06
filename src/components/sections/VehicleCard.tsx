"use client";

import Image from "next/image";
import { useState } from "react";

import type { Vehicle } from "@/data/vehicles";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

type VehicleCardProps = {
  vehicle: Vehicle;
  showBookButton?: boolean;
};

export function VehicleCard({ vehicle, showBookButton = true }: VehicleCardProps) {
  const gallery = vehicle.images.length > 0 ? vehicle.images : ["/window.svg"];
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const hasMultipleImages = gallery.length > 1;

  function showPreviousImage() {
    setActiveImageIndex((current) => (current - 1 + gallery.length) % gallery.length);
  }

  function showNextImage() {
    setActiveImageIndex((current) => (current + 1) % gallery.length);
  }

  return (
    <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <div className="relative overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]">
        <Image
          src={gallery[activeImageIndex]}
          alt={`${vehicle.name} photo ${activeImageIndex + 1}`}
          width={900}
          height={600}
          className="h-48 w-full object-cover"
          priority={false}
        />
        {hasMultipleImages ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-2">
            <button
              type="button"
              onClick={showPreviousImage}
              className="pointer-events-auto rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/95 px-2 py-1 text-xs font-semibold text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface)]"
              aria-label={`Show previous ${vehicle.name} image`}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={showNextImage}
              className="pointer-events-auto rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/95 px-2 py-1 text-xs font-semibold text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface)]"
              aria-label={`Show next ${vehicle.name} image`}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {gallery.map((image, index) => (
            <button
              type="button"
              key={image}
              onClick={() => setActiveImageIndex(index)}
              className={`overflow-hidden rounded-lg border ${
                activeImageIndex === index ? "border-[var(--ccr-accent-strong)]" : "border-[var(--ccr-border)]"
              }`}
              aria-label={`Select ${vehicle.name} image ${index + 1}`}
            >
              <Image
                src={image}
                alt={`${vehicle.name} thumbnail ${index + 1}`}
                width={96}
                height={64}
                className="h-14 w-20 object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">{vehicle.category}</p>
          <h3 className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{vehicle.name}</h3>
        </div>
        <p className="text-sm font-semibold text-[var(--ccr-primary)]">{formatCurrency(vehicle.pricePerDay)}/day</p>
      </div>

      <p className="mt-4 text-sm text-[var(--ccr-muted)]">{vehicle.description}</p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-[var(--ccr-muted)]">
        <p>{vehicle.transmission}</p>
        <p>{vehicle.seats} Seats</p>
        <p>{vehicle.bags} Bags</p>
      </div>

      {showBookButton ? (
        <div className="mt-5">
          <Button href={`/book?vehicle=${vehicle.id}`}>Reserve This Car</Button>
        </div>
      ) : null}
    </article>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import type { Vehicle } from "@/data/vehicles";
import { formatCurrency } from "@/lib/utils";

type VehicleCardVehicle = Vehicle & {
  slug?: string;
  year?: number;
};

type VehicleCardProps = {
  vehicle: VehicleCardVehicle;
  showBookButton?: boolean;
  appearance?: "default" | "featured-home";
};

export function VehicleCard({
  vehicle,
  showBookButton = true,
  appearance = "default",
}: VehicleCardProps) {
  const gallery = vehicle.images.length > 0 ? vehicle.images : ["/window.svg"];
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const hasMultipleImages = gallery.length > 1;
  const detailHref = `/fleet/${vehicle.slug ?? vehicle.id}`;
  const isFeaturedHome = appearance === "featured-home";

  function showPreviousImage() {
    setActiveImageIndex((current) => (current - 1 + gallery.length) % gallery.length);
  }

  function showNextImage() {
    setActiveImageIndex((current) => (current + 1) % gallery.length);
  }

  return (
    <article
      className={
        isFeaturedHome
          ? "group flex h-full flex-col overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[linear-gradient(180deg,var(--ccr-surface),var(--ccr-surface-soft))] p-5 shadow-[0_22px_52px_rgba(8,15,30,0.2)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_78px_rgba(8,15,30,0.28)]"
          : "group flex h-full flex-col overflow-hidden rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-[0_18px_56px_rgba(15,23,42,0.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_72px_rgba(15,23,42,0.14)]"
      }
    >
      <div
        className={
          isFeaturedHome
            ? "relative h-64 overflow-hidden rounded-[1.65rem] bg-[var(--ccr-surface-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:h-[17rem]"
            : "relative h-60 overflow-hidden rounded-[1.45rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]"
        }
      >
        <Image
          src={gallery[activeImageIndex]}
          alt={`${vehicle.name} photo ${activeImageIndex + 1}`}
          fill
          sizes="(min-width: 1280px) 28vw, (min-width: 768px) 44vw, 92vw"
          className={
            isFeaturedHome
              ? "object-cover transition duration-500 group-hover:scale-[1.05]"
              : "object-cover transition duration-500 group-hover:scale-[1.03]"
          }
          priority={false}
        />
        {isFeaturedHome ? (
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,15,30,0.04),rgba(8,15,30,0.2))]" />
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
          <div className="flex flex-wrap gap-2">
            <span
              className={
                isFeaturedHome
                  ? "rounded-full border border-white/16 bg-white/84 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-primary)] shadow-[0_10px_30px_rgba(8,15,30,0.14)] backdrop-blur-sm"
                  : "rounded-full bg-[rgba(10,16,28,0.72)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white"
              }
            >
              {vehicle.category}
            </span>
            {vehicle.year ? (
              <span
                className={
                  isFeaturedHome
                    ? "rounded-full border border-white/12 bg-white/72 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)] shadow-[0_10px_30px_rgba(8,15,30,0.12)] backdrop-blur-sm"
                    : "rounded-full bg-white/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ccr-primary)]"
                }
              >
                {vehicle.year}
              </span>
            ) : null}
          </div>

          {hasMultipleImages ? (
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={showPreviousImage}
                className={
                  isFeaturedHome
                    ? "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[rgba(8,15,30,0.48)] text-white shadow-[0_10px_30px_rgba(8,15,30,0.18)] backdrop-blur-md transition hover:bg-[rgba(8,15,30,0.72)]"
                    : "inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[rgba(10,16,28,0.72)] text-white transition hover:bg-[rgba(10,16,28,0.9)]"
                }
                aria-label={`Show previous ${vehicle.name} image`}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={showNextImage}
                className={
                  isFeaturedHome
                    ? "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[rgba(8,15,30,0.48)] text-white shadow-[0_10px_30px_rgba(8,15,30,0.18)] backdrop-blur-md transition hover:bg-[rgba(8,15,30,0.72)]"
                    : "inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[rgba(10,16,28,0.72)] text-white transition hover:bg-[rgba(10,16,28,0.9)]"
                }
                aria-label={`Show next ${vehicle.name} image`}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {hasMultipleImages ? (
        <div className={isFeaturedHome ? "mt-4 flex gap-2.5 overflow-x-auto pb-1" : "mt-3 flex gap-2 overflow-x-auto pb-1"}>
          {gallery.map((image, index) => (
            <button
              type="button"
              key={`${image}-${index}`}
              onClick={() => setActiveImageIndex(index)}
              className={`relative overflow-hidden border ${
                isFeaturedHome ? "h-16 w-24 rounded-[1.2rem] bg-[var(--ccr-surface)] shadow-[0_10px_24px_rgba(8,15,30,0.08)]" : "h-14 w-20 rounded-2xl"
              } ${activeImageIndex === index ? "border-[var(--ccr-accent-strong)]" : "border-[var(--ccr-border)]"}`}
              aria-label={`Select ${vehicle.name} image ${index + 1}`}
            >
              <Image
                src={image}
                alt={`${vehicle.name} thumbnail ${index + 1}`}
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className={isFeaturedHome ? "mt-6 flex flex-1 flex-col" : "mt-5 flex flex-1 flex-col"}>
        <div className={isFeaturedHome ? "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" : "flex items-start justify-between gap-4"}>
          <div className="min-w-0">
            <Link href={detailHref} className="transition hover:text-[var(--ccr-accent-strong)]">
              <h3
                className={
                  isFeaturedHome
                    ? "text-[2rem] font-semibold leading-[1.02] tracking-[-0.04em] text-[var(--ccr-text)]"
                    : "text-2xl font-semibold tracking-tight text-[var(--ccr-text)]"
                }
              >
                {vehicle.name}
              </h3>
            </Link>
            <p className={isFeaturedHome ? "mt-3 max-w-[28ch] text-[15px] leading-7 text-[var(--ccr-muted)]" : "mt-1 text-sm leading-6 text-[var(--ccr-muted)]"}>
              {vehicle.description}
            </p>
          </div>

          <div
            className={
              isFeaturedHome
                ? "shrink-0 rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 shadow-[0_14px_32px_rgba(8,15,30,0.08)] sm:min-w-[9.5rem] sm:text-right"
                : "shrink-0 rounded-[1.2rem] bg-[var(--ccr-surface-soft)] px-4 py-3 text-right"
            }
          >
            <p className={isFeaturedHome ? "text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--ccr-muted)]" : "text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ccr-muted)]"}>
              From
            </p>
            <p className={isFeaturedHome ? "mt-1 text-[1.9rem] font-semibold tracking-[-0.04em] text-[var(--ccr-text)]" : "mt-1 text-lg font-semibold text-[var(--ccr-text)]"}>
              {formatCurrency(vehicle.pricePerDay)}
            </p>
            <p className={isFeaturedHome ? "text-sm text-[var(--ccr-muted)]" : "text-xs text-[var(--ccr-muted)]"}>per day</p>
          </div>
        </div>

        <div className={isFeaturedHome ? "mt-6 flex flex-wrap gap-2.5 text-[13px] font-medium text-[var(--ccr-muted)]" : "mt-5 grid grid-cols-3 gap-2 text-xs font-medium text-[var(--ccr-muted)]"}>
          <div
            className={
              isFeaturedHome
                ? "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                : "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-center"
            }
          >
            {vehicle.transmission}
          </div>
          <div
            className={
              isFeaturedHome
                ? "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                : "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-center"
            }
          >
            {vehicle.seats} Seats
          </div>
          <div
            className={
              isFeaturedHome
                ? "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                : "rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-center"
            }
          >
            {vehicle.bags} Bags
          </div>
        </div>

        <div className={isFeaturedHome ? "mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ccr-border)] pt-5" : "mt-6 flex flex-wrap items-center justify-between gap-3"}>
          <Link
            href={detailHref}
            className={
              isFeaturedHome
                ? "inline-flex items-center gap-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
                : "text-sm font-semibold text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
            }
          >
            View details
            {isFeaturedHome ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4.5 10h11" strokeLinecap="round" />
                <path d="M11 5.5L15.5 10 11 14.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </Link>

          {showBookButton ? (
            <Button
              href={`/book?vehicle=${vehicle.id}`}
              className={
                isFeaturedHome
                  ? "min-w-[11.5rem] rounded-full bg-[var(--ccr-accent-strong)] px-5 text-white shadow-[0_18px_34px_rgba(8,15,30,0.22)] hover:bg-[var(--ccr-accent)]"
                  : "bg-[var(--ccr-accent-strong)] text-white hover:bg-[var(--ccr-accent)]"
              }
            >
              Reserve This Car
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

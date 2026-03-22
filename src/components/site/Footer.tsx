"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Container } from "@/components/site/Container";
import { siteContent } from "@/data/content";
import { services } from "@/data/services";
import { isStandaloneAuthRoute } from "@/lib/security/clerk";

const exploreLinks = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/services", label: "Services" },
  { href: "/tourist-destinations", label: "Tourist Destinations" },
  { href: "/about", label: "About" },
];

const planLinks = [
  { href: "/rental-policies", label: "Rental Policies" },
  { href: "/driving-in-jamaica", label: "Driving in Jamaica" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin") || (pathname ? isStandaloneAuthRoute(pathname) : false)) {
    return null;
  }

  return (
    <footer className="site-footer mt-20 border-t border-[var(--ccr-border)] bg-[var(--ccr-primary)] text-white">
      <Container className="py-14 md:py-20">
        <div className="flex flex-col gap-8 border-b border-white/10 pb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
              Curated Car Rentals
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Premium vehicle hire, local support, and a smoother start to every Jamaica trip.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/70 md:text-base">
              {siteContent.brandDescription}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/fleet"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/6 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/12"
            >
              Explore Fleet
            </Link>
            <Link
              href="/book"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-transparent bg-[var(--ccr-accent)] px-5 py-2 text-sm font-semibold text-[var(--ccr-primary)] transition hover:bg-[#ffd588]"
            >
              Book Now
            </Link>
          </div>
        </div>

        <div className="grid gap-10 pt-10 md:grid-cols-2 xl:grid-cols-[1.25fr_0.9fr_0.9fr_1.25fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Explore
            </p>
            <ul className="mt-4 space-y-3 text-sm text-white/72">
              {exploreLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Plan Your Trip
            </p>
            <ul className="mt-4 space-y-3 text-sm text-white/72">
              {planLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Services
            </p>
            <ul className="mt-4 space-y-3 text-sm text-white/72">
              {services.map((service) => (
                <li key={service.id}>
                  <Link href={`/services#${service.id}`} className="transition hover:text-white">
                    {service.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Contact
            </p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-white/72">
              <p>{siteContent.addressLines.join(", ")}</p>
              {siteContent.phones.map((phone) => (
                <p key={phone.href}>
                  <a href={phone.href} className="transition hover:text-white">
                    {phone.label}
                  </a>
                </p>
              ))}
              <p>
                <a href={`mailto:${siteContent.email}`} className="transition hover:text-white">
                  {siteContent.email}
                </a>
              </p>
              <p>
                <a href={siteContent.whatsapp.href} className="transition hover:text-white">
                  WhatsApp: {siteContent.whatsapp.label}
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-sm text-white/58 md:flex md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {siteContent.brand}. All rights reserved.</p>
          <p className="mt-3 md:mt-0">{siteContent.tagline}</p>
        </div>
      </Container>
    </footer>
  );
}

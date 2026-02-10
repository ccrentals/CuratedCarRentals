"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Container } from "@/components/site/Container";
import { SiteLogo } from "@/components/site/SiteLogo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/book", label: "Book" },
  { href: "/services", label: "Services" },
  { href: "/tourist-destinations", label: "Destinations" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;

  const [isCompact, setIsCompact] = useState(false);
  const lastScrollYRef = useRef(0);
  const isCompactRef = useRef(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    isCompactRef.current = isCompact;
  }, [isCompact]);

  useEffect(() => {
    const onScroll = () => {
      if (tickingRef.current) return;

      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const scrollingDown = currentY > lastScrollYRef.current;

        const enterCompactAt = 140;
        const exitCompactAt = 48;

        if (!isCompactRef.current && scrollingDown && currentY > enterCompactAt) {
          isCompactRef.current = true;
          setIsCompact(true);
        }

        if (isCompactRef.current && !scrollingDown && currentY < exitCompactAt) {
          isCompactRef.current = false;
          setIsCompact(false);
        }

        lastScrollYRef.current = currentY;
        tickingRef.current = false;
      });
    };

    lastScrollYRef.current = window.scrollY;
    isCompactRef.current = window.scrollY > 140;
    setIsCompact(isCompactRef.current);

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="site-header sticky top-0 z-30 shadow-sm">
      <div
        className={cn(
          "overflow-hidden transition-all duration-500 ease-in-out",
          isCompact ? "pointer-events-none max-h-0 -translate-y-6 opacity-0" : "max-h-60 translate-y-0 opacity-100",
        )}
      >
        <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
          <Container className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="inline-flex items-center gap-3 text-2xl font-extrabold tracking-tight text-[var(--ccr-text)]">
              <SiteLogo size={40} className="h-10 w-10" />
              <span>Curated Car Rentals</span>
            </Link>

            <div className="grid gap-1 text-sm text-[var(--ccr-muted)] md:grid-cols-2 md:gap-4">
              <p>{siteContent.phone}</p>
              <p>{siteContent.email}</p>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link
                href="/admin"
                aria-label="Admin sign in"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="7.5" r="3.5" />
                  <path d="M4 20c1.8-3.5 5-5.5 8-5.5s6.2 2 8 5.5" />
                </svg>
                <span>Admin</span>
              </Link>
              <div className="lg:hidden">
                <Button href="/book" className="px-3 py-1.5 text-xs">
                  Book Now
                </Button>
              </div>
            </div>
          </Container>
        </div>
      </div>

      <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-accent)]/95">
        <Container className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className={cn(
                "inline-flex items-center overflow-hidden transition-all duration-500 ease-in-out",
                isCompact ? "w-32 opacity-100" : "w-0 opacity-0",
              )}
              aria-label="Go to homepage"
            >
              <SiteLogo size={28} className="h-7 w-7" />
              <span className="ml-2 whitespace-nowrap text-sm font-bold uppercase tracking-wide text-[var(--ccr-primary)]">
                Curated
              </span>
            </Link>

            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold uppercase tracking-wide text-[var(--ccr-primary)]">
              {navLinks.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-[var(--ccr-primary-soft)]">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden lg:block">
            <Button href="/book" className="bg-[var(--ccr-primary)] text-white hover:bg-[var(--ccr-primary-soft)]">
              Book Now
            </Button>
          </div>
        </Container>
      </div>
    </header>
  );
}

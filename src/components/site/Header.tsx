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
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  const [isCompact, setIsCompact] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const isCompactRef = useRef(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    isCompactRef.current = isCompact;
  }, [isCompact]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setMobileNavOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (isAdminRoute) return;

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
  }, [isAdminRoute]);

  if (isAdminRoute) return null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileNavOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity duration-200",
            mobileNavOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileNavOpen(false)}
        />

        <aside
          id="mobile-site-nav"
          className={cn(
            "absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-r border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl transition-transform duration-200",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Site navigation"
        >
          <div className="flex items-center justify-between border-b border-[var(--ccr-border)] px-4 py-4">
            <Link href="/" className="inline-flex items-center gap-3 text-base font-extrabold tracking-tight text-[var(--ccr-text)]">
              <SiteLogo size={32} className="h-8 w-8" />
              <span>Curated Car Rentals</span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex items-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)]"
              aria-label="Close menu"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <nav className="grid gap-1 text-sm font-semibold uppercase tracking-wide text-[var(--ccr-primary)]">
              {navLinks.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-xl px-3 py-2 transition-colors hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-primary-soft)]",
                      isActive && "bg-[var(--ccr-surface-soft)] text-[var(--ccr-primary-soft)]",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 text-sm text-[var(--ccr-muted)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent-strong)]">Contact</p>
              <p className="mt-2 break-words">{siteContent.phone}</p>
              <p className="break-words">{siteContent.email}</p>
            </div>

            <div className="mt-6">
              <Button href="/book" className="w-full">
                Book Now
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--ccr-border)] px-4 py-4">
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
          </div>
        </aside>
      </div>

      <header className="site-header sticky top-0 z-30 shadow-sm">
        <div
          className={cn(
            "overflow-hidden transition-all duration-500 ease-in-out",
            isCompact ? "pointer-events-none max-h-0 -translate-y-6 opacity-0" : "max-h-60 translate-y-0 opacity-100",
          )}
        >
          <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
            <Container className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <Link
                href="/"
                className="inline-flex items-center gap-3 text-2xl font-extrabold tracking-tight text-[var(--ccr-text)]"
              >
                <SiteLogo size={40} className="h-10 w-10" />
                <span>Curated Car Rentals</span>
              </Link>

              <div className="min-w-0 grid gap-1 text-sm text-[var(--ccr-muted)] md:grid-cols-2 md:gap-4">
                <p className="break-words">{siteContent.phone}</p>
                <p className="break-words">{siteContent.email}</p>
              </div>

              <div className="hidden items-center gap-2 lg:flex">
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
              </div>
            </Container>
          </div>
        </div>

        <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-accent)]/95">
          <Container className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
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

              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-primary)] hover:bg-white/30 lg:hidden"
                aria-label="Open menu"
                aria-controls="mobile-site-nav"
                aria-expanded={mobileNavOpen}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M4 18h16" />
                </svg>
                <span>Menu</span>
              </button>

              <nav className="hidden flex-wrap gap-x-5 gap-y-2 text-sm font-semibold uppercase tracking-wide text-[var(--ccr-primary)] lg:flex">
                {navLinks.map((item) => (
                  <Link key={item.href} href={item.href} className="hover:text-[var(--ccr-primary-soft)]">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

          <div className="flex items-center gap-2">
              <div className="lg:hidden">
                <ThemeToggle className="whitespace-nowrap px-2.5 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs" />
              </div>
              <Button
                href="/book"
                className="whitespace-nowrap px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm bg-[var(--ccr-primary)] text-white hover:bg-[var(--ccr-primary-soft)]"
              >
                Book Now
              </Button>
            </div>
          </Container>
        </div>
      </header>
    </>
  );
}

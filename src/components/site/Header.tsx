"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Container } from "@/components/site/Container";
import { SiteLogo } from "@/components/site/SiteLogo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { isStandaloneAuthRoute } from "@/lib/security/clerk";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/book", label: "Book" },
  { href: "/services", label: "Services" },
  { href: "/rental-policies", label: "Rental Policies" },
  { href: "/driving-in-jamaica", label: "Driving in Jamaica" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;
  const isStandaloneAuth = pathname ? isStandaloneAuthRoute(pathname) : false;

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

    const compactStart = 56;
    const compactReset = 16;

    const onScroll = () => {
      if (tickingRef.current) return;

      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const scrollingDown = currentY > lastScrollYRef.current;

        if (!isCompactRef.current && scrollingDown && currentY > compactStart) {
          isCompactRef.current = true;
          setIsCompact(true);
        }

        if (isCompactRef.current && !scrollingDown && currentY < compactReset) {
          isCompactRef.current = false;
          setIsCompact(false);
        }

        lastScrollYRef.current = currentY;
        tickingRef.current = false;
      });
    };

    lastScrollYRef.current = window.scrollY;
    isCompactRef.current = window.scrollY > compactStart;
    setIsCompact(isCompactRef.current);

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isAdminRoute]);

  if (isAdminRoute || isStandaloneAuth) return null;

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
            "absolute inset-0 bg-[rgba(6,10,18,0.74)] transition-opacity duration-200",
            mobileNavOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileNavOpen(false)}
        />

        <aside
          id="mobile-site-nav"
          className={cn(
            "absolute left-0 top-0 flex h-full w-80 max-w-[88vw] flex-col border-r border-white/10 bg-[var(--ccr-primary)] text-white shadow-2xl transition-transform duration-200",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Site navigation"
        >
          <div className="border-b border-white/10 px-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-white">
                <SiteLogo size={52} className="h-12 w-12" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold tracking-tight">
                    <span className="ccr-wordmark-curated">Curated</span> Car Rentals
                  </span>
                  <span className="mt-1 block text-xs uppercase tracking-[0.22em] text-white/58">
                    {siteContent.tagline}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/6 px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/10 hover:text-white"
                aria-label="Close menu"
              >
                Close
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            <nav className="grid gap-2 text-sm font-medium text-white/82">
              {navLinks.map((item) => {
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex min-h-11 items-center rounded-2xl px-4 py-3 transition hover:bg-white/8 hover:text-white",
                      isActive && "bg-white/10 text-white",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/6 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
                Contact
              </p>
              <div className="mt-4 space-y-2 text-sm text-white/72">
                {siteContent.phones.map((phone) => (
                  <a key={phone.href} href={phone.href} className="block hover:text-white">
                    {phone.label}
                  </a>
                ))}
                <a href={`mailto:${siteContent.email}`} className="block break-words hover:text-white">
                  {siteContent.email}
                </a>
              </div>
            </div>

            <div className="mt-6">
              <Button href="/book" className="w-full bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd588]">
                Book Now
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-4">
            <ThemeToggle controlId="site-theme-toggle-mobile-drawer" showLabel={false} />
            <Link
              href="/admin/auth"
              className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/6 px-4 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/10 hover:text-white"
              aria-label="Admin sign in"
            >
              Admin
            </Link>
          </div>
        </aside>
      </div>

      <header className="site-header sticky top-0 z-30 border-b border-[var(--ccr-border)] bg-[var(--ccr-bg)]/88 backdrop-blur-xl">
        <Container
          className={cn(
            "lg:hidden",
            "flex items-center justify-between gap-3 transition-all duration-300 ease-out",
            isCompact ? "py-3" : "py-4",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface-soft)]"
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
              <span className="hidden min-[380px]:inline">Menu</span>
            </button>

            <Link
              href="/"
              className="inline-flex min-w-0 items-center gap-3 text-[var(--ccr-text)]"
              aria-label="Go to homepage"
            >
              <SiteLogo
                size={isCompact ? 44 : 52}
                className={cn(
                  "shrink-0 transition-all duration-300",
                  isCompact ? "h-11 w-11" : "h-[52px] w-[52px]",
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold tracking-tight text-[var(--ccr-text)] sm:text-lg">
                  <span className="ccr-wordmark-curated">Curated</span> Car Rentals
                </span>
                <span
                  className={cn(
                    "hidden truncate text-[10px] uppercase tracking-[0.24em] text-[var(--ccr-muted)] transition-all duration-300 min-[420px]:block",
                    isCompact ? "max-h-0 opacity-0" : "max-h-6 opacity-100",
                  )}
                >
                  {siteContent.tagline}
                </span>
              </span>
            </Link>
          </div>

          <Button
            href="/book"
            className="shrink-0 whitespace-nowrap bg-[var(--ccr-accent-strong)] px-4 py-2.5 text-sm text-white hover:bg-[var(--ccr-accent)]"
          >
            Book Now
          </Button>
        </Container>

        <div
          className={cn(
            "hidden lg:block",
            "transition-all duration-300 ease-out",
            isCompact ? "lg:py-3.5" : "lg:py-5",
          )}
        >
          <div className="mx-auto grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-6 lg:px-8 xl:gap-8 xl:px-10 2xl:px-12">
            <div className="flex min-w-0 items-center justify-self-start">
              <Link
                href="/"
                className="inline-flex min-w-0 items-center gap-5 xl:gap-6 text-[var(--ccr-text)]"
                aria-label="Go to homepage"
              >
                <SiteLogo
                  size={isCompact ? 54 : 68}
                  className={cn(
                    "shrink-0 transition-all duration-300",
                    isCompact ? "h-[54px] w-[54px] xl:h-[58px] xl:w-[58px]" : "h-[64px] w-[64px] xl:h-[72px] xl:w-[72px]",
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate font-semibold tracking-tight text-[var(--ccr-text)] transition-all duration-300",
                      isCompact ? "text-lg xl:text-xl" : "text-xl xl:text-2xl",
                    )}
                  >
                    <span className="ccr-wordmark-curated">Curated</span> Car Rentals
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[11px] uppercase tracking-[0.3em] text-[var(--ccr-muted)] transition-all duration-300",
                      isCompact ? "max-h-0 opacity-0" : "max-h-6 opacity-100",
                    )}
                  >
                    {siteContent.tagline}
                  </span>
                </span>
              </Link>
            </div>

            <nav className="flex items-center justify-center gap-5 text-base font-medium text-[var(--ccr-muted)] xl:gap-8 xl:text-[17px]">
              {navLinks.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "whitespace-nowrap transition hover:text-[var(--ccr-text)]",
                      isActive && "text-[var(--ccr-text)]",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center justify-self-end gap-3">
              <ThemeToggle
                controlId="site-theme-toggle-toolbar"
                showLabel={false}
                className="whitespace-nowrap px-4 py-2.5 text-sm"
              />
              <Link
                href="/admin/auth"
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-5 py-2.5 text-sm font-semibold text-[var(--ccr-muted)] transition hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-text)]"
                aria-label="Admin sign in"
              >
                Admin
              </Link>
              <Button
                href="/book"
                className="whitespace-nowrap bg-[var(--ccr-accent-strong)] px-5 py-2.5 text-sm text-white hover:bg-[var(--ccr-accent)]"
              >
                Book Now
              </Button>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

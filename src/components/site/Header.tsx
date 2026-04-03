"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Container } from "@/components/site/Container";
import { SiteLogo } from "@/components/site/SiteLogo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { buttonStyles } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { isStandaloneAuthRoute } from "@/lib/security/clerk";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/services", label: "Services" },
  { href: "/rental-policies", label: "Rental Policies" },
  { href: "/driving-in-jamaica", label: "Driving in Jamaica" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

function isDesktopNavItemActive(pathname: string | null | undefined, href: string) {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;
  const isStandaloneAuth = pathname ? isStandaloneAuthRoute(pathname) : false;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavOpen]);

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
        aria-label="Mobile navigation"
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/55 transition-opacity duration-200",
            mobileNavOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileNavOpen(false)}
        />

        <aside
          id="mobile-site-nav"
          className={cn(
            "absolute left-0 top-0 flex h-full w-[20rem] max-w-[88vw] flex-col bg-[#070b12] text-white shadow-2xl transition-transform duration-200",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="border-b border-white/10 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-white" onClick={() => setMobileNavOpen(false)}>
                <SiteLogo size={56} className="h-12 w-12 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-base font-semibold tracking-tight">
                    <span className="ccr-wordmark-curated">Curated</span> Car Rentals
                  </span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-[0.22em] text-white/60">
                    {siteContent.tagline}
                  </span>
                </span>
              </Link>

              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex min-h-10 items-center rounded-full border border-white/15 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/30 hover:text-white"
                aria-label="Close menu"
              >
                Close
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-4 py-5">
            <ul className="space-y-1">
              {navLinks.map((item) => {
                const isActive = isDesktopNavItemActive(pathname, item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={cn(
                        "flex min-h-11 items-center rounded-full px-4 text-sm font-medium tracking-[0.02em] text-white/78 transition hover:bg-white/8 hover:text-white",
                        isActive && "bg-white/10 text-white",
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="mt-7 rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
                Contact Us
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
          </nav>

          <div className="space-y-3 border-t border-white/10 px-4 py-4">
            <ThemeToggle
              controlId="site-theme-toggle-mobile"
              variant="inverse"
              showLabel
              className="w-full justify-between rounded-full border-white/15 bg-white/6 px-4 text-sm"
            />
            <Link
              href="/book"
              onClick={() => setMobileNavOpen(false)}
              className={buttonStyles({
                variant: "primary",
                size: "lg",
                className: "w-full rounded-full",
              })}
            >
              Book Now
            </Link>
            <Link
              href="/admin/auth"
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/6 px-4 py-2.5 text-sm font-semibold text-white/78 transition hover:bg-white/10 hover:text-white"
            >
              Admin
            </Link>
          </div>
        </aside>
      </div>

      <header
        className={cn(
          "site-header sticky top-0 z-40 border-b border-white/10 bg-[#05080e] text-white transition-shadow duration-200 min-[1160px]:fixed min-[1160px]:inset-x-0 min-[1160px]:top-0",
          isScrolled && "shadow-[0_16px_40px_rgba(0,0,0,0.28)]",
        )}
      >
        <Container className="grid min-h-[4.9rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-3.5 lg:h-24 lg:max-w-[86rem] lg:px-8 min-[1160px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[1160px]:justify-normal min-[1160px]:gap-x-7 min-[1160px]:gap-y-0">
          <div className="flex min-w-0 items-center gap-2 lg:gap-4">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80 transition hover:border-white/30 hover:text-white lg:hidden"
              aria-controls="mobile-site-nav"
              aria-expanded={mobileNavOpen}
              aria-label="Open menu"
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
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
              <span className="hidden min-[380px]:inline">Menu</span>
            </button>

            <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-white lg:gap-3" aria-label="Go to homepage">
              <SiteLogo size={72} className="h-11 w-11 shrink-0 sm:h-12 sm:w-12 lg:h-16 lg:w-16" />
              <span className="hidden min-w-0 min-[1160px]:block">
                <span className="block truncate text-[0.98rem] font-semibold tracking-tight sm:text-[1.05rem] lg:text-[1.2rem]">
                  <span className="ccr-wordmark-curated">Curated</span> Car Rentals
                </span>
                <span className="mt-0.5 hidden text-[10px] uppercase tracking-[0.22em] text-white/62 sm:block">
                  {siteContent.tagline}
                </span>
              </span>
            </Link>
          </div>

          <div className="hidden min-[1160px]:flex min-w-0 items-center justify-center px-6 min-[1160px]:justify-self-center">
            <nav aria-label="Primary" className="min-w-0">
              <ul className="flex items-center gap-7 text-[0.97rem] font-medium text-white/82">
                {navLinks.map((item) => {
                  const isActive = isDesktopNavItemActive(pathname, item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "whitespace-nowrap transition-colors duration-150",
                          isActive
                            ? "text-[var(--ccr-accent-strong)]"
                            : "text-white/82 hover:text-[var(--ccr-accent)]",
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <div className="flex items-center gap-2 min-[1160px]:ml-1 min-[1160px]:gap-3">
            <div className="hidden lg:block">
              <ThemeToggle
                controlId="site-theme-toggle-header"
                variant="inverse"
                showLabel={false}
                className="rounded-full border-white/15 bg-white/6 px-4 py-2 text-sm text-white"
              />
            </div>
            <Link
              href="/book"
              className={buttonStyles({
                variant: "primary",
                size: "md",
                className:
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] sm:px-5 sm:text-sm min-[1160px]:min-h-12 min-[1160px]:px-5 min-[1160px]:py-3",
              })}
            >
              Book Now
            </Link>
            <Link
              href="/admin/auth"
              className="hidden min-h-12 items-center justify-center rounded-full border border-white/15 bg-white/6 px-5 py-3 text-sm font-semibold text-white/72 transition hover:bg-white/10 hover:text-white min-[1160px]:inline-flex"
              aria-label="Admin sign in"
            >
              Admin
            </Link>
          </div>

          <Link
            href="/"
            className="col-span-2 inline-flex min-w-0 items-center text-[0.96rem] font-semibold tracking-tight text-white/88 transition hover:text-white min-[1160px]:hidden"
            aria-label="Go to homepage"
          >
            <span className="truncate">
              <span className="ccr-wordmark-curated">Curated</span> Car Rentals
            </span>
          </Link>
        </Container>
      </header>
    </>
  );
}

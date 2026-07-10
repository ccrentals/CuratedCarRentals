"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Container } from "@/components/site/Container";
import { SiteLogo } from "@/components/site/SiteLogo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { buttonStyles } from "@/components/ui/Button";
import type { LandingContent } from "@/lib/landingContent";
import { isStandaloneAuthRoute } from "@/lib/security/clerk";
import { cn } from "@/lib/utils";

function isDesktopNavItemActive(pathname: string | null | undefined, href: string) {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MobileTopBar({
  content,
  onOpen,
  isOpen,
}: {
  content: LandingContent["global"];
  onOpen: () => void;
  isOpen: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 min-[1160px]:hidden">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80 transition hover:border-white/30 hover:text-white"
        aria-controls="mobile-site-nav"
        aria-expanded={isOpen}
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
        <span className="hidden min-[380px]:inline">{content.headerMenuLabel}</span>
      </button>

      <Link
        href="/"
        className="inline-flex min-w-0 items-end gap-2 text-white"
        aria-label="Go to homepage"
      >
        <SiteLogo size={56} className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
        <span className="min-w-0 self-end pb-[2px]">
          <span
            className="ccr-wordmark-curated block truncate whitespace-nowrap leading-[0.78] text-white"
            style={{ fontSize: "1.2rem" }}
          >
            {content.brand}
          </span>
        </span>
      </Link>
    </div>
  );
}

function MobileDrawerHeader({
  content,
  onClose,
}: {
  content: LandingContent["global"];
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <Link
        href="/"
        className="inline-flex min-w-0 flex-1 items-start gap-1.5 text-white"
        onClick={onClose}
      >
        <SiteLogo size={40} className="h-8 w-8 shrink-0" />
        <span className="min-w-0 pt-[2px]">
          <span className="ccr-wordmark-curated block truncate whitespace-nowrap text-[0.8rem] font-semibold tracking-tight leading-none">
            {content.brand}
          </span>
          <span className="mt-1 block text-[7px] uppercase tracking-[0.16em] text-white/60">
            {content.tagline}
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-white/15 px-2.5 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/70 transition hover:border-white/30 hover:text-white"
        aria-label="Close menu"
      >
        {content.headerCloseMenuLabel}
      </button>
    </div>
  );
}

function MobileDrawerFooter({
  content,
  onClose,
}: {
  content: LandingContent["global"];
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 border-t border-white/10 px-4 py-4">
      <div className="flex flex-nowrap items-center gap-2">
        <div className="min-w-0 basis-0 flex-1">
          <ThemeToggle
            controlId="site-theme-toggle-mobile"
            variant="inverse"
            showLabel={false}
            compact
            className="w-full justify-between rounded-full border-white/15 bg-white/6 px-2.5 text-[11px]"
          />
        </div>
        <Link
          href="/book"
          onClick={onClose}
          className={buttonStyles({
            variant: "primary",
            size: "md",
            className:
              "min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold",
          })}
        >
          {content.headerBookLabel}
        </Link>
      </div>
      <Link
        href="/admin/auth"
        onClick={onClose}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/6 px-4 py-2.5 text-sm font-semibold text-white/78 transition hover:bg-white/10 hover:text-white"
      >
        {content.headerAdminLabel}
      </Link>
    </div>
  );
}

function DesktopBrand({ content }: { content: LandingContent["global"] }) {
  return (
    <Link
      href="/"
      className="hidden shrink-0 self-start pt-3.5 text-white min-[1160px]:inline-flex min-[1160px]:items-start min-[1160px]:gap-2 min-[1280px]:gap-2.5"
      aria-label="Go to homepage"
    >
      <SiteLogo
        size={56}
        className="h-[3.15rem] w-[3.15rem] shrink-0 min-[1280px]:h-14 min-[1280px]:w-14"
      />
      <span className="flex min-w-0 flex-col justify-start pt-[2px]">
        <span className="ccr-wordmark-curated block whitespace-nowrap text-[1.12rem] font-semibold leading-none tracking-tight min-[1280px]:text-[1.28rem]">
          {content.brand}
        </span>
        <span className="mt-1 h-[0.75rem] text-[9px] uppercase tracking-[0.18em] text-white/62">
          <span className="invisible min-[1280px]:visible">{content.tagline}</span>
        </span>
      </span>
    </Link>
  );
}

function DesktopNavShell({
  content,
  pathname,
}: {
  content: LandingContent["global"];
  pathname: string | null;
}) {
  return (
    <div className="hidden min-[1160px]:flex min-w-0 flex-1 items-center justify-center px-3 min-[1280px]:px-4">
      <nav aria-label="Primary" className="min-w-0">
        <ul className="flex items-center gap-4 text-[0.88rem] font-medium text-white/82 min-[1280px]:gap-5 min-[1280px]:text-[0.94rem]">
          {content.navigation.map((item) => {
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
  );
}

export function Header({ content }: { content: LandingContent["global"] }) {
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
          "fixed inset-0 z-50 min-[1160px]:hidden",
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
            "absolute left-0 top-0 flex h-full w-[20rem] max-w-[92vw] flex-col bg-[#070b12] text-white shadow-2xl transition-transform duration-200",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="border-b border-white/10 px-4 py-4">
            <MobileDrawerHeader content={content} onClose={() => setMobileNavOpen(false)} />
          </div>

          <nav className="flex-1 overflow-y-auto px-4 py-5">
            <ul className="space-y-1">
              {content.navigation.map((item) => {
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
                {content.footerContactTitle}
              </p>
              <div className="mt-4 space-y-2 text-sm text-white/72">
                {content.phones.map((phone) => (
                  <a key={phone.href} href={phone.href} className="block hover:text-white">
                    {phone.label}
                  </a>
                ))}
                <Link href="/contact#contact-form" onClick={() => setMobileNavOpen(false)} className="block break-words hover:text-white">
                  {content.footerContactFormLabel}
                </Link>
                <p className="break-words text-white/56">{content.email}</p>
              </div>
            </div>
          </nav>

          <MobileDrawerFooter content={content} onClose={() => setMobileNavOpen(false)} />
        </aside>
      </div>

      <header
        className={cn(
          "site-header fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#05080e] text-white transition-shadow duration-200",
          isScrolled && "shadow-[0_16px_40px_rgba(0,0,0,0.28)]",
        )}
      >
        <Container className="flex min-h-[4.9rem] items-center justify-between gap-3 py-3.5 min-[1160px]:min-h-[5.25rem] min-[1160px]:max-w-[86rem] min-[1160px]:gap-4 min-[1160px]:px-6 min-[1280px]:h-24 min-[1280px]:gap-5 min-[1280px]:px-8">
          <MobileTopBar content={content} onOpen={() => setMobileNavOpen(true)} isOpen={mobileNavOpen} />
          <DesktopBrand content={content} />
          <DesktopNavShell content={content} pathname={pathname} />

          <div className="flex items-center gap-2 min-[1160px]:ml-1 min-[1160px]:gap-2.5 min-[1280px]:gap-3">
            <div className="hidden min-[1160px]:block">
              <ThemeToggle
                controlId="site-theme-toggle-header"
                variant="inverse"
                showLabel={false}
                className="min-w-[6.75rem] rounded-full border-white/15 bg-white/6 px-3 py-2 text-[13px] text-white min-[1280px]:min-w-[7.5rem] min-[1280px]:px-4 min-[1280px]:text-sm"
              />
            </div>
            <Link
              href="/book"
              className={buttonStyles({
                variant: "primary",
                size: "md",
                className:
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] sm:px-5 sm:text-sm min-[1160px]:min-h-12 min-[1160px]:px-4 min-[1160px]:py-3 min-[1280px]:px-5",
              })}
            >
              {content.headerBookLabel}
            </Link>
            <Link
              href="/admin/auth"
              className="hidden min-h-12 items-center justify-center rounded-full border border-white/15 bg-white/6 px-4 py-3 text-sm font-semibold text-white/72 transition hover:bg-white/10 hover:text-white min-[1160px]:inline-flex min-[1280px]:px-5"
              aria-label="Admin sign in"
            >
              {content.headerAdminLabel}
            </Link>
          </div>
        </Container>
      </header>
      <div aria-hidden="true" className="h-[4.9rem] min-[1160px]:h-[5.25rem] min-[1280px]:h-24" />
    </>
  );
}

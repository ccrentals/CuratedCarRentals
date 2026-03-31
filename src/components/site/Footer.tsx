"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Container } from "@/components/site/Container";
import { SiteLogo } from "@/components/site/SiteLogo";
import { siteContent } from "@/data/content";
import { services } from "@/data/services";
import { isStandaloneAuthRoute } from "@/lib/security/clerk";

const quickLinks = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Our Fleet" },
  { href: "/services", label: "Services" },
  { href: "/tourist-destinations", label: "Tourist Destinations" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact" },
  { href: "/book", label: "Book Now" },
];

const socialLinks = [
  { href: "https://facebook.com", label: "Facebook", icon: FacebookIcon },
  { href: "https://instagram.com", label: "Instagram", icon: InstagramIcon },
  { href: "https://twitter.com", label: "Twitter", icon: TwitterIcon },
  { href: "https://youtube.com", label: "YouTube", icon: YouTubeIcon },
];

const legalFooterItems = ["Privacy Policy", "Terms & Conditions", "FAQ"] as const;

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin") || (pathname ? isStandaloneAuthRoute(pathname) : false)) {
    return null;
  }

  return (
    <footer className="site-footer bg-[#070b12] text-white">
      <Container className="max-w-[86rem] px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-10 border-b border-white/10 pb-12 md:grid-cols-2 xl:grid-cols-[1.2fr_0.9fr_0.9fr_1.05fr]">
          <div>
            <div className="flex items-start gap-3">
              <SiteLogo size={64} className="h-14 w-14 shrink-0 text-white" />
              <h2 className="font-display text-[1.9rem] font-bold text-white sm:text-[2.1rem]">
                Curated Car Rentals
              </h2>
            </div>
            <p className="mt-4 max-w-md text-base leading-7 text-white/68">
              {siteContent.brandDescription}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {socialLinks.map((item) => {
                const Icon = item.icon;

                return (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/78 transition hover:border-white/24 hover:bg-white/10 hover:text-white"
                    aria-label={item.label}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="font-display text-2xl font-bold text-white">Quick Links</h3>
            <ul className="mt-5 space-y-3 text-[15px] text-white/72">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-display text-2xl font-bold text-white">Our Services</h3>
            <ul className="mt-5 space-y-3 text-[15px] text-white/72">
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
            <h3 className="font-display text-2xl font-bold text-white">Contact Us</h3>
            <ul className="mt-5 space-y-4 text-[15px] text-white/72">
              <li className="flex gap-3">
                <span className="mt-1 text-white/48">
                  <LocationIcon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block">{siteContent.addressLines[0]}</span>
                  <span className="block">{siteContent.addressLines[1]}</span>
                </span>
              </li>
              {siteContent.phones.map((phone) => (
                <li key={phone.href} className="flex gap-3">
                  <span className="mt-1 text-white/48">
                    <PhoneIcon className="h-4 w-4" />
                  </span>
                  <a href={phone.href} className="transition hover:text-white">
                    {phone.label}
                  </a>
                </li>
              ))}
              <li className="flex gap-3">
                <span className="mt-1 text-white/48">
                  <MessageIcon className="h-4 w-4" />
                </span>
                <a href={siteContent.whatsapp.href} className="transition hover:text-white">
                  WhatsApp: {siteContent.whatsapp.label}
                </a>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 text-white/48">
                  <MailIcon className="h-4 w-4" />
                </span>
                <a href={`mailto:${siteContent.email}`} className="transition hover:text-white">
                  {siteContent.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-6 text-sm text-white/56 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Curated Car Rentals. All rights reserved.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {legalFooterItems.map((item) => (
              <button
                key={item}
                type="button"
                className="border-0 bg-transparent p-0 text-left transition hover:text-white focus:outline-none focus-visible:text-white"
                aria-disabled="true"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M14 9h3V5h-3c-2.761 0-5 2.239-5 5v3H6v4h3v6h4v-6h3.2l.8-4H13v-3c0-.552.448-1 1-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M18.901 5H21l-4.586 5.241L21.81 19h-4.225l-3.31-4.334L10.48 19H8.38l4.904-5.602L8 5h4.333l2.992 3.92L18.901 5Zm-1.481 12.708h1.17L11.697 6.223h-1.255l6.978 11.485Z"
        fill="currentColor"
      />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M21.582 7.197a2.971 2.971 0 0 0-2.09-2.104C17.647 4.6 12 4.6 12 4.6s-5.647 0-7.492.493A2.971 2.971 0 0 0 2.418 7.2C1.924 9.056 1.924 12 1.924 12s0 2.944.494 4.803a2.971 2.971 0 0 0 2.09 2.104c1.845.493 7.492.493 7.492.493s5.647 0 7.492-.493a2.971 2.971 0 0 0 2.09-2.104c.494-1.859.494-4.803.494-4.803s0-2.944-.494-4.803ZM9.9 15.1V8.9l5.2 3.1-5.2 3.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LocationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 21s6-5.586 6-11a6 6 0 1 0-12 0c0 5.414 6 11 6 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5.5 4.5h3l1.5 4-2 1.5c1.02 2.066 2.685 3.731 4.75 4.75l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5C10.82 19.75 4.25 13.18 4.25 5.75A1.5 1.5 0 0 1 5.75 4.25Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 11.5A8.5 8.5 0 0 1 7.2 18.9L3 20l1.1-4.2A8.5 8.5 0 1 1 20 11.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5 7 7 6 7-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

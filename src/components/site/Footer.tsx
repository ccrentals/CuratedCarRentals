"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Container } from "@/components/site/Container";
import { siteContent } from "@/data/content";

const footerLinks = [
  { href: "/fleet", label: "Fleet" },
  { href: "/book", label: "Book" },
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;

  return (
    <footer className="site-footer mt-16 border-t border-[var(--ccr-border)] bg-[var(--ccr-primary)] text-[var(--ccr-muted)]">
      <Container className="py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="text-lg font-bold text-white">{siteContent.brand}</p>
            <p className="mt-2 text-sm">{siteContent.location}</p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Quick Links</p>
            <ul className="mt-3 space-y-2 text-sm">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Contact</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="break-words">{siteContent.phone}</li>
              <li className="break-words">{siteContent.email}</li>
              <li className="break-words">{siteContent.address}</li>
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-[var(--ccr-border)]/40 pt-6 text-sm">
          © {new Date().getFullYear()} {siteContent.brand}. All rights reserved.
        </p>
      </Container>
    </footer>
  );
}

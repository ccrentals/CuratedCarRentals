import Link from "next/link";

import { Container } from "@/components/site/Container";
import { siteContent } from "@/data/content";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Privacy Policy",
  description:
    "Learn how Curated Car Rentals collects, uses, protects, and shares information when you use our website, Android app, or rental services.",
  path: "/privacy",
});

const sections = [
  {
    title: "Information we collect",
    paragraphs: [
      "When you request or manage a reservation, we may collect your name, email address, telephone number, rental dates, vehicle and location choices, delivery address, signature, and booking communications. If required to complete a rental, we may also collect identification, driver’s licence, insurance, or returning-customer verification information.",
      "Our website, app, hosting provider, and security providers may process technical information such as IP address, device or browser type, request timestamps, and security-check results. The Android app does not request precise location, contacts, photos, microphone, or advertising identifiers.",
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      "We use information to provide quotes, check vehicle availability, create and administer reservations, arrange pickup or delivery, process and reconcile payments, communicate with you, provide customer support, prevent fraud and abuse, maintain rental records, and comply with legal, tax, insurance, and accounting obligations.",
      "We do not sell personal information or use the Android app for third-party behavioural advertising.",
    ],
  },
  {
    title: "Payments and service providers",
    paragraphs: [
      "Payments are completed on WiPay’s hosted payment service. Curated Car Rentals receives transaction references and payment status, but the Android app does not collect or store your payment-card number or security code.",
      "We share only the information needed with providers that support reservations, hosting, security, communications, file storage, payment processing, and business administration. These currently include WiPay for payments and Cloudflare Turnstile for abuse prevention. Providers process information under their own terms and privacy practices.",
    ],
  },
  {
    title: "Android app storage",
    paragraphs: [
      "After a reservation is created, the Android app stores a private booking-access credential using the device’s encrypted secure storage. This lets the app retrieve that reservation’s status. You can remove the saved booking from the My Booking screen, and uninstalling the app removes its local app data.",
      "Removing local data does not cancel a reservation or erase records already held by Curated Car Rentals. Contact us separately if you wish to exercise a privacy request.",
    ],
  },
  {
    title: "Retention and security",
    paragraphs: [
      "We retain information for as long as reasonably necessary to provide the rental service, maintain transaction and vehicle records, resolve disputes, prevent fraud, and meet legal, tax, insurance, and accounting requirements. Retention periods vary by record type and applicable obligations.",
      "We use administrative, technical, and organisational safeguards designed to protect information. No internet transmission or storage system can be guaranteed completely secure.",
    ],
  },
  {
    title: "Your choices and rights",
    paragraphs: [
      "You may ask to access, correct, or delete personal information, or object to certain uses, subject to identity verification and records we must retain. You may also withdraw consent where consent is the applicable basis, though this does not affect earlier lawful processing.",
      "The service is intended for adults who are eligible to rent a vehicle and is not directed to children. We do not knowingly collect personal information from children through the booking service.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              Website and Android app
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              Privacy Policy
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
              This policy explains how Curated Car Rentals handles information when you use our
              website, Android application, or rental services.
            </p>
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">Last updated: July 14, 2026</p>
          </div>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl space-y-7">
            {sections.map((section) => (
              <article
                key={section.title}
                className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-7 shadow-[0_18px_56px_rgba(15,23,42,0.07)] sm:p-8"
              >
                <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                  {section.title}
                </h2>
                <div className="mt-5 space-y-4">
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            ))}

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-7 sm:p-8">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                Contact us
              </h2>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">
                For privacy questions or requests, contact Curated Car Rentals at{" "}
                <a className="font-semibold text-[var(--ccr-accent-strong)]" href={`mailto:${siteContent.email}`}>
                  {siteContent.email}
                </a>
                , call {siteContent.phone}, or write to {siteContent.address}.
              </p>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">
                We may update this policy as our services or legal obligations change. The current
                version will remain available at this URL. See our{" "}
                <Link className="font-semibold text-[var(--ccr-accent-strong)]" href="/rental-policies">
                  rental policies
                </Link>{" "}
                for booking terms.
              </p>
            </article>
          </div>
        </Container>
      </section>
    </>
  );
}

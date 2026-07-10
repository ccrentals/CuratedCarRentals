import { JsonLd } from "@/components/seo/JsonLd";
import { Container } from "@/components/site/Container";
import { loadLandingContent } from "@/lib/landingContent";
import { publicPageMetadata } from "@/lib/seo";
import {
  breadcrumbStructuredData,
  faqStructuredData,
} from "@/lib/structuredData";

export const metadata = publicPageMetadata({
  title: "Rental Policies and Requirements",
  description:
    "Review Curated Car Rentals requirements, security deposit terms, insurance coverage notes, reservation options, and airport pickup policy.",
  path: "/rental-policies",
});

export default async function RentalPoliciesPage() {
  const { content } = await loadLandingContent();
  const page = content.rentalPolicies;
  return (
    <>
      <JsonLd
        data={[
          faqStructuredData(page.faqs),
          breadcrumbStructuredData([
            { name: "Home", path: "/" },
            { name: "Rental Policies", path: "/rental-policies" },
          ]),
        ]}
      />
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
              {page.description}
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl space-y-8">
            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                {page.requirementsTitle}
              </h2>
              <ul className="mt-6 space-y-4">
                {page.requirements.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                  >
                    <span className="mt-1 text-[var(--ccr-accent-strong)]">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                {page.depositTitle}
              </h2>
              <ul className="mt-6 space-y-4">
                {page.deposit.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                  >
                    <span className="mt-1 text-[var(--ccr-accent-strong)]">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                {page.insuranceTitle}
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                {page.insuranceDescription}
              </p>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-warning-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h3 className="text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                    {page.declineTitle}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                    {page.declineDescription}
                  </p>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-success-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h3 className="text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                    {page.coverageTitle}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                    {page.coverageDescription}
                  </p>
                </article>
              </div>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-accent-strong)]">
                {page.reservationTitle}
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                {page.reservationIntro}
              </p>

              <h3 className="mt-8 text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                {page.reservationOptionsTitle}
              </h3>

              <div className="mt-6 space-y-6">
                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-success-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-success-border)]">
                    {page.paidTitle}
                  </h4>
                  <ul className="mt-4 space-y-3">
                    {page.paidItems.map((item) => (
                      <li
                        key={item}
                        className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                      >
                        <span className="mt-1 text-[var(--ccr-status-success-border)]">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-warning-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-warning-border)]">
                    {page.unpaidTitle}
                  </h4>
                  <ul className="mt-4 space-y-3">
                    {page.unpaidItems.map((item) => (
                      <li
                        key={item}
                        className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                      >
                        <span className="mt-1 text-[var(--ccr-status-warning-border)]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-info-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-info-border)]">
                    {page.airportTitle}
                  </h4>
                  <p className="mt-3 text-base font-medium leading-7 text-[var(--ccr-light-surface-muted)]">
                    {page.airportNote}
                  </p>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-accent-border)] bg-white p-6 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <p className="text-base font-medium leading-7 text-[var(--ccr-light-surface-text)]">
                    {page.recommendation}
                  </p>
                </article>
              </div>
            </article>

            <section aria-labelledby="rental-faq-heading">
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                  {page.faqEyebrow}
                </p>
                <h2
                  id="rental-faq-heading"
                  className="mt-3 font-display text-3xl font-bold text-[var(--ccr-light-surface-text)]"
                >
                  {page.faqTitle}
                </h2>
              </div>
              <div className="space-y-3">
                {page.faqs.map((item) => (
                  <details
                    key={item.question}
                    className="group rounded-[1.4rem] border border-[var(--ccr-border)] bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]"
                  >
                    <summary className="cursor-pointer list-none pr-8 text-base font-semibold text-[var(--ccr-light-surface-text)] marker:content-none">
                      {item.question}
                    </summary>
                    <p className="mt-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </Container>
      </section>
    </>
  );
}

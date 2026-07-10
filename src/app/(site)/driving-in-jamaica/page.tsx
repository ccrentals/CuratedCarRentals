import Link from "next/link";

import { Container } from "@/components/site/Container";
import { loadLandingContent } from "@/lib/landingContent";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Driving in Jamaica Guide",
  description:
    "Review practical driving tips for Jamaica, including road conditions, left-side driving, speed limits, maps, and safe travel planning.",
  path: "/driving-in-jamaica",
});

export default async function DrivingInJamaicaPage() {
  const { content } = await loadLandingContent();
  const page = content.driving;
  return (
    <>
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
          <div className="grid gap-6 md:grid-cols-2">
            {page.tips.map((item) => (
              <article
                key={item.title}
                className="flex h-full flex-col rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-7 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
              >
                <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">{item.title}</h2>
                <p className="mb-5 mt-4 text-base leading-8 text-[var(--ccr-muted)]">{item.description}</p>
                <p className="mt-auto rounded-[1.2rem] bg-[var(--ccr-surface-soft)] px-4 py-4 text-sm font-medium text-[var(--ccr-text)]">
                  {item.tip}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-[var(--ccr-primary)] py-16 text-white">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-4xl font-bold text-white md:text-5xl">
              {page.ctaTitle}
            </h2>
            <p className="mt-4 text-lg leading-8 text-white/76">
              {page.ctaDescription}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href={page.primaryCta.href}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#2ea9f4] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#48b9fa]"
              >
                {page.primaryCta.label}
              </Link>
              <Link
                href={page.secondaryCta.href}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/8 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/12"
              >
                {page.secondaryCta.label}
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

import Link from "next/link";

import { Container } from "@/components/site/Container";
import { drivingTips } from "@/data/content";

export default function DrivingInJamaicaPage() {
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
            Driving in Jamaica
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
            Essential information for a safe and enjoyable driving experience on the island.
          </p>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="grid gap-6 md:grid-cols-2">
            {drivingTips.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-7 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
              >
                <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">{item.title}</h2>
                <p className="mt-4 text-base leading-8 text-[var(--ccr-muted)]">{item.description}</p>
                <p className="mt-5 rounded-[1.2rem] bg-[var(--ccr-surface-soft)] px-4 py-4 text-sm font-medium text-[var(--ccr-text)]">
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
              Ready for your Jamaican road trip?
            </h2>
            <p className="mt-4 text-lg leading-8 text-white/76">
              Let us help you select the perfect vehicle for your adventure.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href="/book"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#2ea9f4] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#48b9fa]"
              >
                Book Your Car Now
              </Link>
              <Link
                href="/fleet"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/8 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/12"
              >
                View Fleet
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

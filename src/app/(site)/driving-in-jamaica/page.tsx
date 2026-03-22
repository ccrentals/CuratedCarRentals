import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { drivingTips } from "@/data/content";

export default function DrivingInJamaicaPage() {
  return (
    <>
      <PublicPageIntro
        eyebrow="Road Guidance"
        title="Driving in Jamaica"
        description="Essential information for a safe and enjoyable driving experience on the island."
        primaryAction={{ href: "/fleet", label: "Explore Fleet" }}
        secondaryAction={{ href: "/book", label: "Book Your Car Now" }}
      />

      <PublicSection
        eyebrow="Know Before You Go"
        title="Helpful guidance for a smoother island drive."
        description="These are the key reminders most visitors need before getting behind the wheel in Jamaica."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {drivingTips.map((item, index) => (
            <article
              key={item.title}
              className="flex h-full flex-col rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ccr-surface-soft)] text-sm font-semibold text-[var(--ccr-text)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--ccr-text)]">{item.title}</h2>
              </div>
              <p className="mt-5 mb-5 text-sm leading-7 text-[var(--ccr-muted)]">{item.description}</p>
              <div className="mt-auto rounded-[1.5rem] bg-[var(--ccr-surface-soft)] px-4 py-4 text-sm font-medium text-[var(--ccr-text)]">
                {item.tip}
              </div>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Ready for the Road"
        title="Ready for your Jamaican road trip?"
        description="Let us help you select the perfect vehicle for your adventure."
        primaryAction={{ href: "/book", label: "Book Your Car Now" }}
        secondaryAction={{ href: "/fleet", label: "View Fleet" }}
      />
    </>
  );
}

"use client";

import { type FormEvent, useRef, useState } from "react";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { Button } from "@/components/ui/Button";
import { reassuranceItems, siteContent } from "@/data/content";

export default function ContactPage() {
  const startedAtRef = useRef<number>(Date.now());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!turnstileToken) {
      setError("Please complete the security check before sending your message.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.NODE_ENV !== "production") {
        headers["x-ccr-dev-bypass-rate-limit"] = "1";
      }

      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          email,
          message,
          company,
          startedAt: startedAtRef.current,
          source: "contact_page",
          turnstileToken,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; field?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        if (payload?.error === "RATE_LIMIT") {
          setError("Too many messages from your network. Please try again in about an hour.");
        } else {
          setError(payload?.error || "Unable to send your message right now. Please try again.");
        }
        setTurnstileToken(null);
        setTurnstileResetKey((value) => value + 1);
        return;
      }

      setSuccess("Message sent successfully. We’ll be in touch shortly.");
      setName("");
      setEmail("");
      setMessage("");
      setCompany("");
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
      startedAtRef.current = Date.now();
      try {
        window.localStorage.setItem("ccr:contact-message-created-at", String(Date.now()));
      } catch {
        // Ignore localStorage write issues; submit already succeeded.
      }
    } catch {
      setError("Unable to send your message right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PublicPageIntro
        eyebrow="Contact"
        title="Get in touch with Curated Car Rentals"
        description="Reach out for booking questions, vehicle guidance, airport pickup support, or help planning the right rental for your trip."
        primaryAction={{ href: "/book", label: "Start Your Booking" }}
        secondaryAction={{ href: "/fleet", label: "Browse Fleet" }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Phone
            </p>
            <p className="mt-3 text-sm font-semibold text-white">{siteContent.phones[0]?.label}</p>
          </article>
          <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Email
            </p>
            <p className="mt-3 text-sm font-semibold text-white">{siteContent.email}</p>
          </article>
          <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Kingston Office
            </p>
            <p className="mt-3 text-sm font-semibold text-white">{siteContent.address}</p>
          </article>
        </div>
      </PublicPageIntro>

      <PublicSection className="pt-12 md:pt-16">
        <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="space-y-5">
            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                Contact Details
              </p>
              <div className="mt-5 space-y-4 text-sm leading-7 text-[var(--ccr-muted)]">
                <div>
                  <p className="font-semibold text-[var(--ccr-text)]">Call or WhatsApp</p>
                  <div className="mt-2 space-y-1">
                    {siteContent.phones.map((phone) => (
                      <a
                        key={phone.href}
                        href={phone.href}
                        className="block transition hover:text-[var(--ccr-accent-strong)]"
                      >
                        {phone.label}
                      </a>
                    ))}
                    <a
                      href={siteContent.whatsapp.href}
                      className="block transition hover:text-[var(--ccr-accent-strong)]"
                    >
                      WhatsApp: {siteContent.whatsapp.label}
                    </a>
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-[var(--ccr-text)]">Email</p>
                  <a
                    href={`mailto:${siteContent.email}`}
                    className="mt-2 block transition hover:text-[var(--ccr-accent-strong)]"
                  >
                    {siteContent.email}
                  </a>
                </div>
                <div>
                  <p className="font-semibold text-[var(--ccr-text)]">Visit us</p>
                  <p className="mt-2">{siteContent.address}</p>
                </div>
              </div>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/75 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                Before You Send
              </p>
              <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--ccr-muted)]">
                <p>
                  Share your travel dates, pickup area, and the type of vehicle you are considering
                  so our team can guide you quickly.
                </p>
                <p>
                  If you are coordinating airport pickup, corporate travel, or a longer rental, note
                  that in your message and we&apos;ll point you to the best next step.
                </p>
              </div>
            </article>
          </div>

          <section className="rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:p-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                Secure Message Form
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ccr-text)]">
                Send a message
              </h2>
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">
                Use the form below for inquiries and booking questions. Your message is protected by
                our security checks before it reaches the team.
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="sr-only" aria-hidden="true">
                Company
                <input
                  type="text"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0"
                />
              </label>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="block text-sm text-[var(--ccr-muted)]">
                  Name
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    className="mt-2 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-[var(--ccr-text)] shadow-sm outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>
                <label className="block text-sm text-[var(--ccr-muted)]">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className="mt-2 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-[var(--ccr-text)] shadow-sm outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>
              </div>

              <label className="block text-sm text-[var(--ccr-muted)]">
                Message
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                  className="mt-2 min-h-36 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-[var(--ccr-text)] shadow-sm outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                />
              </label>

              <div className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  Security Check
                </p>
                <TurnstileWidget
                  action="public_contact"
                  onTokenChange={setTurnstileToken}
                  resetKey={turnstileResetKey}
                  className="mt-3"
                />
              </div>

              {success ? (
                <p className="rounded-[1.1rem] border border-emerald-300/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  {success}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-[1.1rem] border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  className="w-full bg-[var(--ccr-primary)] px-6 py-3 text-[var(--ccr-on-primary)] hover:bg-[var(--ccr-primary-soft)] sm:w-auto"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Send Inquiry"}
                </Button>
                <p className="text-sm text-[var(--ccr-muted)]">
                  Prefer to book right away? Start your reservation online and contact us if you need help.
                </p>
              </div>
            </form>
          </section>
        </div>
      </PublicSection>

      <PublicSection
        eyebrow="Why Guests Reach Out"
        title="Helpful support before, during, and after your reservation."
        description="The same straightforward service we bring to the fleet and booking experience should be visible when you need answers."
        className="bg-[var(--ccr-surface)]/55"
      >
        <div className="grid gap-5 md:grid-cols-3">
          {reassuranceItems.map((item) => (
            <article
              key={item.title}
              className="rounded-[1.7rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <p className="text-lg font-semibold text-[var(--ccr-text)]">{item.title}</p>
              <p className="mt-3 text-sm leading-7 text-[var(--ccr-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Ready When You Are"
        title="Browse the fleet or start your reservation when you feel ready."
        description="If you already know your dates, head to booking. If you are still comparing options, explore the fleet first and return when you are ready to reserve."
        primaryAction={{ href: "/book", label: "Start Your Booking" }}
        secondaryAction={{ href: "/fleet", label: "Browse Fleet" }}
      />
    </>
  );
}

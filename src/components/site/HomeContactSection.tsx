"use client";

import Link from "next/link";
import Image from "next/image";
import { type FormEvent, useRef, useState } from "react";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { Container } from "@/components/site/Container";
import { buttonStyles } from "@/components/ui/Button";
import type { LandingContent } from "@/lib/landingContent";

export function HomeContactSection({
  content,
  globalContent,
}: {
  content: LandingContent["home"];
  globalContent: LandingContent["global"];
}) {
  const startedAtRef = useRef<number>(Date.now());
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
          name: `${firstName} ${lastName}`.trim(),
          email,
          message: phone ? `${message}\n\nPhone Number: ${phone}` : message,
          company,
          startedAt: startedAtRef.current,
          source: "home_page_contact",
          turnstileToken,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
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
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setMessage("");
      setCompany("");
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
      startedAtRef.current = Date.now();
    } catch {
      setError("Unable to send your message right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section id="contact" className="relative overflow-hidden bg-white py-12 sm:py-14 md:py-24">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[1fr_1.02fr] lg:items-start lg:gap-10">
          <div className="overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/55 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div
              className="relative h-56 overflow-hidden sm:h-64 lg:h-72"
              role="img"
              aria-label={content.contactImage.alt}
            >
              <Image
                src={content.contactImage.src}
                alt=""
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(135deg,rgba(7,11,18,0.8),rgba(46,169,244,0.45))]"
              />
            </div>

            <div className="grid gap-3 p-4 sm:gap-4 sm:p-5 md:grid-cols-2 md:gap-5 md:p-6">
              <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  {content.contactVisitLabel}
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--ccr-muted)]">
                  {globalContent.addressLines[0]}
                  <br />
                  {globalContent.addressLines[1]}
                </p>
              </article>

              <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  {content.contactCallLabel}
                </p>
                <div className="mt-3 space-y-1 text-sm leading-7 text-[var(--ccr-muted)]">
                  {globalContent.phones.map((item) => (
                    <a key={item.href} href={item.href} className="block transition hover:text-[var(--ccr-text)]">
                      {item.label}
                    </a>
                  ))}
                </div>
              </article>

              <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  {content.contactEmailLabel}
                </p>
                <Link
                  href="/contact#contact-form"
                  className="mt-3 block text-sm leading-7 text-[var(--ccr-muted)] transition hover:text-[var(--ccr-text)]"
                >
                  {content.contactEmailActionLabel}
                </Link>
                <p className="mt-1 break-words text-sm leading-7 text-[var(--ccr-muted)]">{globalContent.email}</p>
              </article>

              <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                  {content.contactWhatsappLabel}
                </p>
                <div className="mt-3 space-y-1">
                  {globalContent.whatsapps.map((whatsapp) => (
                    <a
                      key={whatsapp.href}
                      href={whatsapp.href}
                      className="block text-sm leading-7 text-[var(--ccr-muted)] transition hover:text-[var(--ccr-text)]"
                    >
                      {whatsapp.label}
                    </a>
                  ))}
                </div>
              </article>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              {content.contactEyebrow}
            </p>
            <h2 className="mt-4 font-display text-[2rem] font-bold leading-tight text-[var(--ccr-light-surface-text)] sm:text-[2.35rem] md:text-5xl">
              {content.contactHeading}
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--ccr-light-surface-muted)] sm:text-lg sm:leading-8">
              {content.contactDescription}
            </p>

            <form className="mt-8 space-y-5 sm:mt-9 sm:space-y-6" onSubmit={handleSubmit}>
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

              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <label className="block min-w-0 text-sm font-medium text-[var(--ccr-light-surface-text)]">
                  First Name *
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                    className="mt-2 w-full rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>

                <label className="block min-w-0 text-sm font-medium text-[var(--ccr-light-surface-text)]">
                  Last Name *
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                    className="mt-2 w-full rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <label className="block min-w-0 text-sm font-medium text-[var(--ccr-light-surface-text)]">
                  Email Address *
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className="mt-2 w-full rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>

                <label className="block min-w-0 text-sm font-medium text-[var(--ccr-light-surface-text)]">
                  Phone Number
                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    autoComplete="tel"
                    className="mt-2 w-full rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-[var(--ccr-light-surface-text)]">
                Your Message *
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                  rows={5}
                  className="mt-2 w-full rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
                />
              </label>

              <div className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/80 p-3.5 sm:p-4">
                <TurnstileWidget
                  action="public_contact"
                  onTokenChange={setTurnstileToken}
                  resetKey={turnstileResetKey}
                />
              </div>

              {success ? (
                <p className="rounded-[1rem] border border-emerald-300/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                  {success}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-[1rem] border border-red-300/60 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className={buttonStyles({
                  variant: "primary",
                  size: "lg",
                  className: "w-full rounded-full disabled:cursor-not-allowed sm:w-auto",
                })}
              >
                {isSubmitting ? content.contactSubmittingLabel : content.contactSubmitLabel}
              </button>
            </form>
          </div>
        </div>
      </Container>
    </section>
  );
}

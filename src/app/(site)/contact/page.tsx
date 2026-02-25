"use client";

import { type FormEvent, useRef, useState } from "react";

import { SectionHeading } from "@/components/sections/SectionHeading";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";

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
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <SectionHeading
            eyebrow="Contact"
            title="Get in touch with Curated Car Rentals"
            description="Use this template form for inquiries and booking questions."
            tone="light"
          />
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Contact Details</h2>
            <ul className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
              <li>Phone: {siteContent.phone}</li>
              <li>Email: {siteContent.email}</li>
              <li>Address: {siteContent.address}</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Send a Message</h2>
            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
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
              <label className="block text-sm text-[var(--ccr-muted)]">
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
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
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
              <label className="block text-sm text-[var(--ccr-muted)]">
                Message
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                  className="mt-1 min-h-28 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
              <TurnstileWidget
                action="public_contact"
                onTokenChange={setTurnstileToken}
                resetKey={turnstileResetKey}
              />
              {success ? (
                <p className="rounded-lg border border-emerald-300/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {success}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Inquiry"}
              </Button>
            </form>
          </section>
        </div>
      </Container>
    </div>
  );
}

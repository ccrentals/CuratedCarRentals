"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { vehicles } from "@/data/vehicles";
import { formatCurrency } from "@/lib/utils";
import { formatJmd } from "@/lib/money";

const sampleRentalDays = 5;

type PublicVehicle = {
  id: string;
  make: string;
  model: string;
  daily_rate_cents: number;
  deposit_cents: number;
};

export default function BookPage() {
  const router = useRouter();
  const todayKey = (() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  })();
  const [vehicleOptions, setVehicleOptions] = useState<PublicVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function daysInclusive(start: string, end: string) {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  }


  useEffect(() => {
    fetch("/api/public/vehicles")
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data?.vehicles) ? data.vehicles : [];
        const simplified = list.map((item: any) => ({
          id: item.id,
          make: item.make,
          model: item.model,
          daily_rate_cents: item.daily_rate_cents ?? 0,
          deposit_cents: item.deposit_cents ?? 0,
        }));
        setVehicleOptions(simplified);
        if (simplified.length > 0) {
          setVehicleId((current) => current || simplified[0].id);
        }
      })
      .catch(() => {
        setVehicleOptions([]);
      });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const response = await fetch("/api/public/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId,
        fullName,
        email,
        phone,
        startDate,
        endDate,
        pickupLocation,
      }),
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data?.error ?? "Unable to create booking");
      return;
    }

    router.push(`/bookings/${data.bookingId}`);
  }

  const selectedVehicle = vehicleOptions.find((option) => option.id === vehicleId);
  const days = daysInclusive(startDate, endDate);
  const total = selectedVehicle ? selectedVehicle.daily_rate_cents * days : 0;
  const deposit = selectedVehicle ? selectedVehicle.deposit_cents : 0;
  const balance = Math.max(0, total - deposit);

  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-8 md:px-8">
          <SectionHeading
            eyebrow="Book"
            title="Secure Your Car in Minutes"
            description="Choose your vehicle and review an estimated deposit and balance. Final payment flow will be connected later."
            tone="light"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Sample Rental</p>
              <p className="mt-1 text-lg font-bold text-white">{sampleRentalDays} Days</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Deposit Rate</p>
              <p className="mt-1 text-lg font-bold text-white">{Math.round(siteContent.bookingDepositRate * 100)}%</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Currency</p>
              <p className="mt-1 text-lg font-bold text-white">JMD</p>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[var(--ccr-text)]">Reservation Details</h2>
            <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <label className="text-sm text-[var(--ccr-muted)] md:col-span-2">
                Vehicle
                <select
                  value={vehicleId}
                  onChange={(event) => setVehicleId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)]"
                  required
                >
                  {vehicleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.make} {option.model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Full Name
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="Your name"
                  required
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Phone
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="+1 876 555 1234"
                  required
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Pickup Date
                <input
                  type="date"
                  min={todayKey}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  required
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Return Date
                <input
                  type="date"
                  min={startDate || todayKey}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  required
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)] md:col-span-2">
                Pickup Location
                <input
                  type="text"
                  value={pickupLocation}
                  onChange={(event) => setPickupLocation(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="Montego Bay Airport"
                  required
                />
              </label>
              {error ? (
                <p className="text-sm text-red-600 md:col-span-2">{error}</p>
              ) : null}
              <div className="md:col-span-2">
                <Button className="w-full" type="submit">
                  {loading ? "Submitting..." : "Submit Booking Request"}
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[var(--ccr-text)]">Estimate Guide</h2>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              Example pricing below uses a {sampleRentalDays}-day rental with a {Math.round(siteContent.bookingDepositRate * 100)}%
              deposit.
            </p>
            <div className="mt-5 space-y-3">
              {vehicles.map((vehicle) => {
                const total = vehicle.pricePerDay * sampleRentalDays;
                const deposit = Math.round(total * siteContent.bookingDepositRate);
                const balance = total - deposit;

                return (
                  <div
                    key={vehicle.id}
                    className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
                  >
                    <p className="font-semibold text-[var(--ccr-text)]">{vehicle.name}</p>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">Total: {formatCurrency(total)}</p>
                    <p className="text-sm text-[var(--ccr-muted)]">Deposit: {formatCurrency(deposit)}</p>
                    <p className="text-sm text-[var(--ccr-muted)]">Balance on pickup: {formatCurrency(balance)}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Summary</h3>
              <div className="mt-3 grid gap-2 text-sm text-[var(--ccr-text)]">
                <p>Days: <span className="font-semibold">{days}</span></p>
                <p>Total rental: <span className="font-semibold">{formatJmd(total)}</span></p>
                <p>Deposit online: <span className="font-semibold">{formatJmd(deposit)}</span></p>
                <p>Balance on pickup: <span className="font-semibold">{formatJmd(balance)}</span></p>
              </div>
            </div>
          </section>
        </div>
      </Container>
    </div>
  );
}

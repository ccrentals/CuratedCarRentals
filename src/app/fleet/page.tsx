import { VehicleCard } from "@/components/sections/VehicleCard";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { vehicles } from "@/data/vehicles";

const fleetHighlights = ["Compact Cars", "Sedans", "SUVs", "Automatic Options"];

export default function FleetPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ccr-accent)]">Fleet</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold tracking-tight text-white md:text-5xl">
            Choose the right vehicle for your Jamaica trip
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-200 md:text-lg">
            Browse our curated selection of clean, reliable rentals for solo travel, couples, and families.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {fleetHighlights.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
              >
                {item}
              </span>
            ))}
          </div>

          <div className="mt-6">
            <Button href="/book" className="bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd16d]">
              Book Your Vehicle
            </Button>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 md:p-6">
          <div className="grid gap-5 md:grid-cols-2">
            {vehicles.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        </section>
      </Container>
    </div>
  );
}

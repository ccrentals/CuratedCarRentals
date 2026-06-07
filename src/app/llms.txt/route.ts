import { siteContent } from "@/data/content";
import { services } from "@/data/services";
import { getPublicVehicles } from "@/lib/publicVehicles";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";

export const dynamic = "force-dynamic";

function formatJmd(value: number) {
  return `JMD ${new Intl.NumberFormat("en-JM", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

export async function GET() {
  const vehicles = await getPublicVehicles().catch(() => []);
  const serviceLines = services.map(
    (service) => `- [${service.title}](${absoluteUrl(`/services#${service.id}`)}): ${service.description}`,
  );
  const vehicleLines = vehicles.map(
    (vehicle) =>
      `- [${vehicle.name}](${absoluteUrl(`/fleet/${encodeURIComponent(vehicle.slug || vehicle.id)}`)}): ${vehicle.category}, ${vehicle.transmission}, ${vehicle.seats} seats, listed from ${formatJmd(vehicle.daily_rate_cents)} per day.`,
  );

  const body = [
    `# ${SITE_NAME}`,
    "",
    `> ${siteContent.brandDescription}`,
    "",
    "Curated Car Rentals is a car rental business based in Kingston, Jamaica. Public website information is intended for rental research and reservation planning. Vehicle availability and final totals depend on the dates, options, and live booking quote selected by the customer.",
    "",
    "## Primary pages",
    `- [Home](${absoluteUrl("/")})`,
    `- [Fleet](${absoluteUrl("/fleet")}): Publicly listed rental vehicles and daily pricing.`,
    `- [Book a vehicle](${absoluteUrl("/book")}): Live date, availability, pricing, and reservation flow.`,
    `- [Rental policies](${absoluteUrl("/rental-policies")}): Driver requirements, deposits, insurance, reservation, and airport pickup terms.`,
    `- [Driving in Jamaica](${absoluteUrl("/driving-in-jamaica")}): Practical island driving guidance.`,
    `- [Tourist destinations](${absoluteUrl("/tourist-destinations")}): Jamaica road-trip planning ideas.`,
    `- [Contact](${absoluteUrl("/contact")}): Official contact details and secure inquiry form.`,
    "",
    "## Services",
    ...serviceLines,
    "",
    "## Published vehicles",
    ...(vehicleLines.length > 0
      ? vehicleLines
      : ["- Refer to the fleet page for the current published vehicle list."]),
    "",
    "## Verified business details",
    `- Location: ${siteContent.address}`,
    `- Primary phone: ${siteContent.phone}`,
    `- Email: ${siteContent.email}`,
    `- Currency: Jamaican dollars (JMD)`,
    "- Service area: Jamaica",
    "",
    "## Important booking facts",
    "- Drivers must be 23 years or older and hold a driver's license that has been valid for at least one year.",
    "- All rentals require a security deposit; the applicable amount depends on the vehicle.",
    "- A paid reservation secures the selected vehicle and is required for airport pickup.",
    "- Optional insurance may affect the final total.",
    "- Do not infer availability from this document. Use the live booking flow for selected dates.",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

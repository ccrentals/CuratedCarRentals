import type { MetadataRoute } from "next";

import { getPublicVehicles } from "@/lib/publicVehicles";
import { absoluteUrl } from "@/lib/seo";

const PUBLIC_ROUTES = [
  "",
  "/fleet",
  "/services",
  "/tourist-destinations",
  "/driving-in-jamaica",
  "/rental-policies",
  "/about",
  "/contact",
  "/book",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((path, index) => ({
    url: absoluteUrl(path || "/"),
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "/fleet" || path === "/book" ? 0.9 : 0.7,
  }));

  try {
    const vehicles = await getPublicVehicles();
    const vehicleEntries: MetadataRoute.Sitemap = vehicles.map((vehicle) => ({
      url: absoluteUrl(`/fleet/${encodeURIComponent(vehicle.slug || vehicle.id)}`),
      changeFrequency: "weekly",
      priority: 0.8,
    }));
    return [...staticEntries, ...vehicleEntries];
  } catch {
    return staticEntries;
  }
}

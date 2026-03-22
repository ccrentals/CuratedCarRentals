export type ServiceItem = {
  id: string;
  title: string;
  description: string;
  detail: string;
};

export const services: ServiceItem[] = [
  {
    id: "airport",
    title: "Airport Pickup",
    description:
      "Free airport pickup from Norman Manley International Airport in Kingston with any paid reservation.",
    detail:
      "Start your Jamaican adventure the moment you land with coordinated pickup that keeps arrival day simple and stress-free.",
  },
  {
    id: "chauffeur",
    title: "Chauffeur Service",
    description:
      "Professional drivers with local road knowledge so you can relax and enjoy the scenery.",
    detail:
      "Ideal for guests who want a polished, effortless travel experience for meetings, airport transfers, or sightseeing days.",
  },
  {
    id: "wedding",
    title: "Wedding Packages",
    description:
      "Premium wedding vehicle service for couples, guests, and special occasion transport.",
    detail:
      "We help make the day feel seamless with elegant vehicle presentation and dependable coordination for the wedding schedule.",
  },
  {
    id: "corporate",
    title: "Corporate Rentals",
    description:
      "Priority booking, flexible terms, and dedicated support for business travel needs.",
    detail:
      "Built for companies that need straightforward rental management and dependable transport for executives, staff, or visiting teams.",
  },
  {
    id: "long-term",
    title: "Long-term Rentals",
    description:
      "Extended rental options that offer convenience and stronger value for longer stays in Jamaica.",
    detail:
      "Enjoy the flexibility of having your own vehicle for weeks or months while keeping the service level and support expected from a premium rental brand.",
  },
];

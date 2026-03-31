export type ServiceItem = {
  id: string;
  title: string;
  description: string;
  detail?: string;
  imageSrc: string;
  imageAlt: string;
};

export const services: ServiceItem[] = [
  {
    id: "airport",
    title: "Airport Pickup",
    description:
      "We offer free airport pickup from Norman Manley International Airport in Kingston with any paid reservation. Start your Jamaican adventure the moment you land!",
    imageSrc: "/live-site/services/airport-pickup.png",
    imageAlt: "Airport Pickup Service",
  },
  {
    id: "chauffeur",
    title: "Chauffeur Service",
    description:
      "Leave the driving to us with our professional chauffeur service. Our experienced drivers are knowledgeable about Jamaica's roads and attractions, allowing you to relax and enjoy the scenery.",
    imageSrc: "/live-site/services/chauffeur-service.png",
    imageAlt: "Chauffeur Service",
  },
  {
    id: "wedding",
    title: "Wedding Packages",
    description:
      "Make your special day even more memorable with our premium wedding vehicle services. We offer decorated luxury vehicles for the wedding party and guests.",
    imageSrc: "/live-site/services/wedding-packages.png",
    imageAlt: "Wedding Packages",
  },
  {
    id: "corporate",
    title: "Corporate Rentals",
    description:
      "We offer specialized corporate rental packages with priority booking, flexible terms, and dedicated account management for businesses of all sizes.",
    imageSrc: "/live-site/services/corporate-rentals.png",
    imageAlt: "Corporate Rental Service",
  },
  {
    id: "long-term",
    title: "Long-term Rentals",
    description:
      "For extended stays in Jamaica, our long-term rental options offer convenience and significant savings. Enjoy the comfort of having your own vehicle for weeks or months.",
    imageSrc: "/live-site/services/long-term-rentals.png",
    imageAlt: "Long-term Rental Service",
  },
];

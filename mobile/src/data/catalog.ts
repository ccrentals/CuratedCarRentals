import type { ImageProps } from "expo-image";

export type Vehicle = {
  id: string;
  name: string;
  category: string;
  year: number;
  transmission: "Automatic" | "Manual";
  seats: number;
  bags: number;
  dailyRate: number;
  securityDeposit: number;
  description: string;
  images: ImageProps["source"][];
  slug?: string;
  source?: "bundled" | "live";
};

export const vehicles: Vehicle[] = [
  {
    id: "toyota-yaris",
    name: "Toyota Yaris",
    category: "Compact",
    year: 2020,
    transmission: "Automatic",
    seats: 5,
    bags: 2,
    dailyRate: 5800,
    securityDeposit: 15000,
    description: "Fuel-efficient and easy to park, ideal for city drives and short trips.",
    source: "bundled",
    images: [
      require("../../assets/cars/toyota-yaris-2020-1.jpg"),
      require("../../assets/cars/toyota-yaris-2020-2.jpg"),
      require("../../assets/cars/toyota-yaris-2020-3.jpg"),
    ],
  },
  {
    id: "honda-fit",
    name: "Honda Fit",
    category: "Economy",
    year: 2020,
    transmission: "Automatic",
    seats: 5,
    bags: 3,
    dailyRate: 6200,
    securityDeposit: 15000,
    description: "Comfortable daily driver with flexible cargo space for island adventures.",
    source: "bundled",
    images: [
      require("../../assets/cars/honda-fit-2020-1.jpg"),
      require("../../assets/cars/honda-fit-2020-2.jpg"),
      require("../../assets/cars/honda-fit-2020-3.jpg"),
    ],
  },
  {
    id: "toyota-corolla",
    name: "Toyota Corolla",
    category: "Sedan",
    year: 2020,
    transmission: "Automatic",
    seats: 5,
    bags: 3,
    dailyRate: 7400,
    securityDeposit: 20000,
    description: "Reliable sedan with smooth handling for airport pickups and highway travel.",
    source: "bundled",
    images: [
      require("../../assets/cars/toyota-corolla-2020-1.jpg"),
      require("../../assets/cars/toyota-corolla-2020-2.jpg"),
      require("../../assets/cars/toyota-corolla-2020-3.jpg"),
    ],
  },
  {
    id: "nissan-xtrail",
    name: "Nissan X-Trail",
    category: "SUV",
    year: 2020,
    transmission: "Automatic",
    seats: 5,
    bags: 4,
    dailyRate: 9800,
    securityDeposit: 30000,
    description: "Spacious SUV that handles family travel and beach gear with ease.",
    source: "bundled",
    images: [
      require("../../assets/cars/nissan-xtrail-1.jpg"),
      require("../../assets/cars/nissan-xtrail-2.jpg"),
      require("../../assets/cars/nissan-xtrail-3.jpg"),
    ],
  },
];

export const services = [
  { id: "airport", title: "Airport Pickup", description: "Free pickup from Norman Manley International Airport with any paid reservation.", image: require("../../assets/services/airport-pickup.png") },
  { id: "chauffeur", title: "Chauffeur Service", description: "Relax with a professional driver who knows Jamaica's roads and attractions.", image: require("../../assets/services/chauffeur-service.png") },
  { id: "wedding", title: "Wedding Packages", description: "Premium decorated vehicles for wedding parties and guests.", image: require("../../assets/services/wedding-packages.png") },
  { id: "corporate", title: "Corporate Rentals", description: "Flexible terms and dedicated support for businesses of all sizes.", image: require("../../assets/services/corporate-rentals.png") },
  { id: "long-term", title: "Long-term Rentals", description: "Convenient weekly and monthly options for extended stays.", image: require("../../assets/services/long-term-rentals.png") },
] as const;

export const destinations = [
  { name: "Dunn's River Falls", location: "Ocho Rios", description: "Climb a world-famous cascading waterfall surrounded by lush tropical vegetation.", image: require("../../assets/destinations/dunns-river-falls.png") },
  { name: "Blue Mountains", location: "Kingston", description: "Hike cloud forests and discover the home of Jamaica's world-famous coffee.", image: require("../../assets/destinations/blue-mountains.png") },
  { name: "Seven Mile Beach", location: "Negril", description: "White sand, clear water and unforgettable west-coast sunsets.", image: require("../../assets/destinations/seven-mile-beach.png") },
  { name: "Rose Hall Great House", location: "Montego Bay", description: "Explore a historic mansion with remarkable views and fascinating stories.", image: require("../../assets/destinations/rose-hall-great-house.png") },
  { name: "Green Grotto Caves", location: "Discovery Bay", description: "Walk a limestone labyrinth rich in natural beauty and Jamaican history.", image: require("../../assets/destinations/green-grotto-caves.png") },
  { name: "Martha Brae River Rafting", location: "Montego Bay", description: "Drift through tropical scenery on a traditional bamboo raft.", image: require("../../assets/destinations/martha-brae-river-rafting.png") },
] as const;

export const drivingTips = [
  { title: "Drive on the left", text: "Take extra care after stops, turns and when entering a roundabout." },
  { title: "Plan for road conditions", text: "Rural roads may be narrow or uneven, so allow more travel time." },
  { title: "Follow posted limits", text: "Speeds are displayed in kilometres per hour and seat belts are mandatory." },
  { title: "Keep offline maps", text: "Download your route before leaving in case mobile reception becomes limited." },
] as const;

export const contact = {
  phones: ["+1 (876) 379-7163", "+1 (876) 372-6218", "+1 (876) 533-9386", "+1 (561) 247-2653"],
  email: "info@curatedcarrentals.com",
  address: "166 Old Hope Road, Kingston, Jamaica",
  whatsapp: "https://wa.me/18763797163",
} as const;

export const formatJmd = (amount: number) => `JMD $${Math.round(amount).toLocaleString("en-JM")}`;

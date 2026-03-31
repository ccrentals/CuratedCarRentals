import { BOOKING_LOCATION_LABELS } from "@/lib/bookings/bookingLocations";

export type CustomerFleetBootstrapVehicle = {
  slug: string;
  legacyId: string;
  make: string;
  model: string;
  name: string;
  year: number;
  category: string;
  seats: number;
  bags: number;
  transmission: "Automatic" | "Manual";
  dailyRateJmd: number;
  depositJmd: number;
  featured?: boolean;
  description: string;
  sourceImages: string[];
  publicOrder: number;
};

const CUSTOMER_SITE_ORIGIN = "https://curatedcarrentals.com";

function absoluteCustomerImage(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${CUSTOMER_SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

const FLEET_PRICE_NOTE =
  "Our simple pricing includes all statutory fees and taxes - (only optional Insurance is extra)";

export const CUSTOMER_BOOKING_LOCATIONS = [
  BOOKING_LOCATION_LABELS.OFFICE,
  BOOKING_LOCATION_LABELS.AIRPORT,
] as const;

export const CUSTOMER_FLEET_BOOTSTRAP: CustomerFleetBootstrapVehicle[] = [
  {
    slug: "subaru-impreza-sport",
    legacyId: "customer-subaru-impreza-sport",
    make: "Subaru",
    model: "Impreza Sport",
    name: "Subaru Impreza Sport",
    year: 2015,
    category: "Hatchback",
    seats: 5,
    bags: 2,
    transmission: "Automatic",
    dailyRateJmd: 7200,
    depositJmd: 7000,
    featured: true,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/7b6b607a-5b7b-44be-88e2-112fbf549184.png")],
    publicOrder: 1,
  },
  {
    slug: "nissan-x-trail",
    legacyId: "customer-nissan-x-trail",
    make: "Nissan",
    model: "X-Trail",
    name: "Nissan X-Trail",
    year: 2018,
    category: "SUV",
    seats: 5,
    bags: 4,
    transmission: "Automatic",
    dailyRateJmd: 12000,
    depositJmd: 11500,
    featured: true,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/3321df17-a658-465c-88ba-2d3f609cc087.png")],
    publicOrder: 2,
  },
  {
    slug: "subaru-xv",
    legacyId: "customer-subaru-xv",
    make: "Subaru",
    model: "XV",
    name: "Subaru XV",
    year: 2018,
    category: "Crossover",
    seats: 5,
    bags: 3,
    transmission: "Automatic",
    dailyRateJmd: 8800,
    depositJmd: 8500,
    featured: true,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/8fb3d1dc-1f98-4496-95b2-14c4992c4d85.png")],
    publicOrder: 3,
  },
  {
    slug: "daihatsu-mira-es",
    legacyId: "customer-daihatsu-mira-es",
    make: "Daihatsu",
    model: "Mira ES",
    name: "Daihatsu Mira ES",
    year: 2020,
    category: "Economy",
    seats: 4,
    bags: 2,
    transmission: "Automatic",
    dailyRateJmd: 5200,
    depositJmd: 5000,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/daihatsu-mira-es.jpeg")],
    publicOrder: 4,
  },
  {
    slug: "bmw-2-series-active-tourer",
    legacyId: "customer-bmw-2-series-active-tourer",
    make: "BMW",
    model: "2 Series Active Tourer",
    name: "BMW 2 Series Active Tourer",
    year: 2018,
    category: "MPV",
    seats: 5,
    bags: 3,
    transmission: "Automatic",
    dailyRateJmd: 9400,
    depositJmd: 9250,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/6e807963-ab97-4110-a0af-0b8715153484.png")],
    publicOrder: 5,
  },
  {
    slug: "bmw-530i",
    legacyId: "customer-bmw-530i",
    make: "BMW",
    model: "530i",
    name: "BMW 530i",
    year: 2023,
    category: "Luxury Sedan",
    seats: 5,
    bags: 3,
    transmission: "Automatic",
    dailyRateJmd: 36000,
    depositJmd: 15000,
    description: FLEET_PRICE_NOTE,
    sourceImages: [absoluteCustomerImage("/lovable-uploads/855da7fb-27f7-49f5-8292-b09def5ac1e0.png")],
    publicOrder: 6,
  },
];

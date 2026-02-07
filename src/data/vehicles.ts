export type Vehicle = {
  id: string;
  name: string;
  category: string;
  transmission: "Automatic" | "Manual";
  seats: number;
  bags: number;
  pricePerDay: number;
  images: string[];
  featured?: boolean;
  description: string;
};

export const vehicles: Vehicle[] = [
  {
    id: "toyota-yaris",
    name: "Toyota Yaris",
    category: "Compact",
    transmission: "Automatic",
    seats: 5,
    bags: 2,
    pricePerDay: 5800,
    images: [
      "/cars/real/toyota-yaris-2020-1.jpg",
      "/cars/real/toyota-yaris-2020-2.jpg",
      "/cars/real/toyota-yaris-2020-3.jpg",
    ],
    featured: true,
    description: "Fuel-efficient and easy to park, ideal for city drives and short trips.",
  },
  {
    id: "honda-fit",
    name: "Honda Fit",
    category: "Economy",
    transmission: "Automatic",
    seats: 5,
    bags: 3,
    pricePerDay: 6200,
    images: [
      "/cars/real/honda-fit-2020-1.jpg",
      "/cars/real/honda-fit-2020-2.jpg",
      "/cars/real/honda-fit-2020-3.jpg",
    ],
    featured: true,
    description: "Comfortable daily driver with flexible cargo space for island adventures.",
  },
  {
    id: "toyota-corolla",
    name: "Toyota Corolla",
    category: "Sedan",
    transmission: "Automatic",
    seats: 5,
    bags: 3,
    pricePerDay: 7400,
    images: [
      "/cars/real/toyota-corolla-2020-1.jpg",
      "/cars/real/toyota-corolla-2020-2.jpg",
      "/cars/real/toyota-corolla-2020-3.jpg",
    ],
    description: "Reliable sedan with smooth handling for airport pickups and highway travel.",
  },
  {
    id: "nissan-xtrail",
    name: "Nissan X-Trail",
    category: "SUV",
    transmission: "Automatic",
    seats: 5,
    bags: 4,
    pricePerDay: 9800,
    images: [
      "/cars/real/nissan-xtrail-1.jpg",
      "/cars/real/nissan-xtrail-2.jpg",
      "/cars/real/nissan-xtrail-3.jpg",
    ],
    description: "Spacious SUV that handles family travel and beach gear with ease.",
  },
];

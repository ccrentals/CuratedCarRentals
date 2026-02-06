export const siteContent = {
  brand: "Curated Car Rentals",
  location: "Jamaica",
  phone: "+1 (876) 555-0144",
  email: "bookings@curatedcarrentals.com",
  address: "Montego Bay, St. James, Jamaica",
  heroHeadline: "Rent a car in Jamaica — clean vehicles, simple booking.",
  heroDescription:
    "Choose from reliable vehicles, confirm in minutes, and enjoy stress-free island travel.",
  bookingDepositRate: 0.3,
};

export type Destination = {
  name: string;
  parish: string;
  description: string;
};

export const destinations: Destination[] = [
  {
    name: "Doctor's Cave Beach",
    parish: "St. James",
    description: "A classic Montego Bay beach with clear water and nearby dining.",
  },
  {
    name: "Dunn's River Falls",
    parish: "St. Ann",
    description: "A must-visit waterfall experience with guided climbing routes.",
  },
  {
    name: "Blue Mountains",
    parish: "St. Andrew",
    description: "Scenic drives and cool views, great for day trips and coffee tours.",
  },
  {
    name: "Seven Mile Beach",
    parish: "Westmoreland",
    description: "Long sandy coastline in Negril with sunsets and relaxed nightlife.",
  },
];

export const aboutHighlights = [
  "Locally operated team with responsive communication.",
  "Straightforward rental terms with no hidden surprises.",
  "A curated fleet selected for comfort, reliability, and value.",
];

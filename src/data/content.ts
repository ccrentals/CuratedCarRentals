export const siteContent = {
  brand: "Curated Car Rentals",
  tagline: "You Drive Our Passion",
  location: "Kingston, Jamaica",
  phone: "+1 (876) 379-7163",
  phones: [
    { label: "+1 (876) 379-7163 (Jamaica)", href: "tel:+18763797163" },
    { label: "+1 (876) 533-9386 (Jamaica)", href: "tel:+18765339386" },
    { label: "+1 (561) 247-2653 (USA)", href: "tel:+15612472653" },
  ],
  email: "info@curatedcarrentals.com",
  address: "166 Old Hope Road, Kingston, Jamaica",
  addressLines: ["166 Old Hope Road", "Kingston, Jamaica"],
  whatsapp: {
    label: "+1 (876) 533-9386",
    href: "https://wa.me/8765339386",
  },
  heroHeadline: "Experience Jamaica's Beauty with Our Premium Car Collection",
  heroDescription:
    "Discover the freedom to explore Kingston and beyond with our meticulously curated fleet of vehicles.",
  heroPricingNote:
    "Our Simple Pricing includes all fees and taxes - No Surprises! (*optional insurance is extra)",
  brandDescription:
    "Your premier car rental service in Kingston, Jamaica. Offering a carefully curated fleet of vehicles to enhance your Jamaican adventure.",
  aboutIntro:
    "Learn more about our mission, values, and the team behind Curated Car Rentals, providing exceptional service for your Jamaican adventure.",
  aboutHeading: "Your Premier Car Rental Experience in Kingston",
  aboutDescription:
    "At Curated Car Rentals, we're passionate about providing exceptional vehicles and service for your Jamaican adventure. Our carefully selected fleet combines comfort, style, and reliability to enhance your exploration of our beautiful island.",
  aboutSupport:
    "Whether you're here for business or leisure, our team is dedicated to making your rental experience seamless from start to finish.",
  mission: [
    "At Curated Car Rentals, our mission is to provide visitors to Jamaica with a seamless, stress-free transportation experience that enhances their overall journey on our beautiful island.",
    "We believe that having the right vehicle is essential to exploring Jamaica's diverse landscapes, from bustling city centers to serene coastal roads and lush mountainsides.",
    "By focusing on personalized service, transparency, and quality, we aim to be the preferred choice for travelers seeking to experience Jamaica on their own terms.",
  ],
  bookingDepositRate: 0.3,
};

export const reassuranceItems = [
  {
    title: "Simple pricing",
    description: "All fees and taxes are included up front so your booking feels clear and predictable.",
  },
  {
    title: "Kingston-based support",
    description: "Local guidance and responsive assistance for business travel, holidays, and family trips.",
  },
  {
    title: "Curated fleet",
    description: "Comfortable, reliable vehicles chosen to make island driving feel easy from pickup to return.",
  },
];

export const aboutFeatures = [
  {
    title: "Premium Insurance",
    description: "Comprehensive coverage for worry-free exploration of Jamaica.",
  },
  {
    title: "24/7 Support",
    description: "Round-the-clock assistance wherever your journey takes you.",
  },
  {
    title: "Well-Maintained Fleet",
    description: "Meticulously serviced vehicles for reliability and comfort.",
  },
  {
    title: "Convenient Location",
    description: "Easily accessible from Kingston's airport and major hotels.",
  },
  {
    title: "Premium Service",
    description: "Personalized experience tailored to your Jamaican adventure.",
  },
  {
    title: "Local Expertise",
    description: "Insider tips and guidance from our knowledgeable local team.",
  },
];

export const aboutHighlights = aboutFeatures.map((item) => item.title);

export const testimonials = [
  {
    name: "Sarah Thompson",
    location: "Toronto, Canada",
    quote:
      "Curated Car Rentals made our Jamaican honeymoon unforgettable. The premium SUV was immaculate, and their service was exceptional from start to finish.",
  },
  {
    name: "Marcus Johnson",
    location: "New York, USA",
    quote:
      "As a business traveler, I appreciate efficiency and reliability. The vehicle was ready on arrival, the paperwork was minimal, and the return process was seamless.",
  },
  {
    name: "Emma Rodriguez",
    location: "London, UK",
    quote:
      "I was nervous about driving in Jamaica, but the team provided excellent guidance and a perfect vehicle for my needs. Their local tips were invaluable.",
  },
];

export type Destination = {
  name: string;
  location: string;
  description: string;
};

export const destinations: Destination[] = [
  {
    name: "Dunn's River Falls",
    location: "Ocho Rios",
    description:
      "A famous cascading waterfall where visitors can climb up through the flowing water, surrounded by lush tropical vegetation. One of Jamaica's most visited attractions.",
  },
  {
    name: "Blue Mountains",
    location: "Kingston",
    description:
      "Home to the world-famous coffee and Jamaica's highest peak. Perfect for hiking, bird watching, and experiencing cloud forest ecosystems.",
  },
  {
    name: "Seven Mile Beach",
    location: "Negril",
    description:
      "A pristine stretch of white sand beach known for its crystal clear waters, stunning sunsets, and laid-back atmosphere.",
  },
  {
    name: "Rose Hall Great House",
    location: "Montego Bay",
    description:
      "A historic mansion with a fascinating history, supposedly haunted by the White Witch. Offers beautiful ocean views and guided tours.",
  },
  {
    name: "Green Grotto Caves",
    location: "Discovery Bay",
    description:
      "A labyrinth of limestone caves featuring emerald-colored waters, stunning rock formations, and fascinating historical significance.",
  },
  {
    name: "Martha Brae River Rafting",
    location: "Montego Bay",
    description:
      "Experience the tranquil beauty of Jamaica on a traditional bamboo raft down the emerald-green Martha Brae River through lush tropical landscapes.",
  },
];

export type DrivingTip = {
  title: string;
  description: string;
  tip: string;
};

export const drivingTips: DrivingTip[] = [
  {
    title: "Road Conditions",
    description:
      "While roads in major cities like Kingston, Montego Bay, and tourist areas are generally in good condition, rural areas can have narrow, winding roads with occasional potholes or unpaved stretches.",
    tip: "Plan extra travel time when going to rural destinations.",
  },
  {
    title: "Driving Side",
    description:
      "Jamaica follows the British system, so you'll drive on the left-hand side of the road. Take your time to adjust, especially at intersections and roundabouts.",
    tip: "Stay left, especially after stops and turns.",
  },
  {
    title: "Traffic Rules",
    description:
      "Speed limits are usually posted in kilometers per hour, with 50 km/h in urban areas and 80 km/h on highways. Maintain a defensive driving approach and watch for less prominent signs.",
    tip: "Seat belts are mandatory for all passengers.",
  },
  {
    title: "GPS/Maps",
    description:
      "GPS apps like Google Maps work well in Jamaica, but it's smart to download offline maps in case of connectivity issues. A physical map can also help in low-signal areas.",
    tip: "Download offline maps before your trip.",
  },
];

export const rentalPolicyRequirements = [
  "Drivers must be 23 years or older to rent any vehicle.",
  "Driver's license must be at least 1 year old and in good standing.",
];

export const rentalPolicyDeposit = [
  "All rentals require a security deposit.",
  "Security deposits start at $15,000+ JMD (Jamaican Dollars), depending on the vehicle class.",
  "Security deposit is 100% refundable after vehicle is returned in the same condition you received it.",
];

export const reservationOptions = {
  intro: "You can book online to check our available vehicles, dates, and prices and place a reservation.",
  paid: [
    "Pay your reservation fee online.",
    "Your booking is guaranteed.",
    "Vehicle is secured for your selected date.",
    "Reservation fee goes toward your total rental cost.",
    "FREE airport pickup at Kingston Airport.",
  ],
  unpaid: [
    "Reserve without payment.",
    "Not guaranteed.",
    "Subject to vehicle availability at pickup.",
    "NO airport pickup available.",
  ],
  airportPickupNote: "Airport pickup is provided ONLY with a PAID reservation.",
  recommendation:
    "To avoid inconvenience, we strongly recommend making a paid reservation to guarantee your booking.",
};

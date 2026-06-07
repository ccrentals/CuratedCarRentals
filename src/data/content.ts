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
    "At Curated Car Rentals, our mission is to provide visitors to Jamaica with a seamless, stress-free transportation experience that enhances their overall journey on our beautiful island. We believe that having the right vehicle is essential to exploring Jamaica's diverse landscapes, from bustling city centers to serene coastal roads and lush mountainsides.",
    "We're committed to offering well-maintained, reliable vehicles paired with exceptional customer service, ensuring that each client's rental experience is as enjoyable as their Jamaican adventure. By focusing on personalized service, transparency, and quality, we aim to be the preferred choice for travelers seeking to experience Jamaica on their own terms.",
  ],
  bookingDepositRate: 0.3,
  homeBookingTitle: "Book Your Vehicle",
  homeBookingDescription: "Reserve your perfect vehicle with our integrated booking system.",
  contactHeading: "We'd Love to Hear From You",
  contactDescription:
    "Have questions about our vehicles, services or need assistance with your booking? Our friendly team is here to help make your car rental experience perfect.",
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
    avatar: "/live-site/testimonials/sarah-thompson.jpg",
    quote:
      "Curated Car Rentals made our Jamaican honeymoon unforgettable! The premium SUV was immaculate, and their service was exceptional from start to finish. Can't recommend them enough!",
  },
  {
    name: "Marcus Johnson",
    location: "New York, USA",
    avatar: "/live-site/testimonials/marcus-johnson.jpg",
    quote:
      "As a business traveler, I appreciate efficiency and reliability. Curated Car Rentals delivered both. The vehicle was ready on arrival, the paperwork was minimal, and the return process was seamless.",
  },
  {
    name: "Emma Rodriguez",
    location: "London, UK",
    avatar: "/live-site/testimonials/emma-rodriguez.jpg",
    quote:
      "I was nervous about driving in Jamaica, but the team at Curated Car Rentals provided excellent guidance and a perfect vehicle for my needs. Their local tips were invaluable and made our trip special.",
  },
];

export type Destination = {
  name: string;
  location: string;
  description: string;
  imageSrc: string;
};

export const destinations: Destination[] = [
  {
    name: "Dunn's River Falls",
    location: "Ocho Rios",
    description:
      "A famous cascading waterfall where visitors can climb up through the flowing water, surrounded by lush tropical vegetation. One of Jamaica's most visited attractions.",
    imageSrc: "/live-site/destinations/dunns-river-falls.png",
  },
  {
    name: "Blue Mountains",
    location: "Kingston",
    description:
      "Home to the world-famous coffee and Jamaica's highest peak. Perfect for hiking, bird watching, and experiencing cloud forest ecosystems.",
    imageSrc: "/live-site/destinations/blue-mountains.png",
  },
  {
    name: "Seven Mile Beach",
    location: "Negril",
    description:
      "A pristine stretch of white sand beach known for its crystal clear waters, stunning sunsets, and laid-back atmosphere.",
    imageSrc: "/live-site/destinations/seven-mile-beach.png",
  },
  {
    name: "Rose Hall Great House",
    location: "Montego Bay",
    description:
      "A historic mansion with a fascinating history, supposedly haunted by the White Witch. Offers beautiful ocean views and guided tours.",
    imageSrc: "/live-site/destinations/rose-hall-great-house.png",
  },
  {
    name: "Green Grotto Caves",
    location: "Discovery Bay",
    description:
      "A labyrinth of limestone caves featuring emerald-colored waters, stunning rock formations, and fascinating historical significance. Once used by Jamaica's first inhabitants and later as a hiding spot for runaway slaves.",
    imageSrc: "/live-site/destinations/green-grotto-caves.png",
  },
  {
    name: "Martha Brae River Rafting",
    location: "Montego Bay",
    description:
      "Experience the tranquil beauty of Jamaica on a traditional bamboo raft down the emerald-green Martha Brae River. This three-mile journey offers a peaceful scenic adventure through lush tropical landscapes.",
    imageSrc: "/live-site/destinations/martha-brae-river-rafting.png",
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
      "While the roads in major cities like Kingston, Montego Bay, and tourist areas are generally in good condition, rural areas can have narrow, winding roads with occasional potholes or unpaved stretches. Drive cautiously, especially in less populated areas.",
    tip: "Plan extra travel time when going to rural destinations.",
  },
  {
    title: "Driving Side",
    description:
      "Jamaica follows the British system, so you'll drive on the left-hand side of the road. This can be challenging for drivers accustomed to right-hand driving. Take your time to adjust, especially at intersections and roundabouts.",
    tip: "Stay left, especially after stops and turns.",
  },
  {
    title: "Traffic Rules",
    description:
      "Speed limits are usually posted in kilometers per hour (km/h), with 50 km/h (31 mph) in urban areas, 80 km/h (50 mph) on highways, and lower in school zones. Be aware that road signs and markings might not be as prominent as in other countries. Local drivers might be more aggressive, so maintain a defensive driving approach.",
    tip: "Seat belts are mandatory for all passengers.",
  },
  {
    title: "GPS/Maps",
    description:
      "While GPS apps like Google Maps work well in Jamaica, it's advisable to download offline maps in case of connectivity issues. A physical map can also be handy, especially in areas with poor mobile reception.",
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
    "Vehicle availability is not guaranteed without payment.",
    "A deposit is required to guarantee availability.",
    "Subject to availability until the deposit is paid.",
    "NO airport pickup available.",
  ],
  airportPickupNote: "Airport pickup is provided ONLY with a PAID reservation.",
  recommendation:
    "To avoid inconvenience, we strongly recommend making a paid reservation to guarantee your booking.",
};

export const rentalFaqs = [
  {
    question: "What is the minimum age to rent a vehicle?",
    answer: "Drivers must be 23 years or older to rent a vehicle from Curated Car Rentals.",
  },
  {
    question: "How long must my driver's license have been valid?",
    answer:
      "Your driver's license must have been valid for at least one year and must be in good standing.",
  },
  {
    question: "Is a security deposit required?",
    answer:
      "Yes. Every rental requires a refundable security deposit. The amount depends on the vehicle class and starts at JMD 15,000.",
  },
  {
    question: "Does an unpaid reservation guarantee the vehicle?",
    answer:
      "No. Vehicle availability is not guaranteed until the required reservation payment has been completed.",
  },
  {
    question: "When is airport pickup available?",
    answer:
      "Airport pickup from Norman Manley International Airport is available with a paid reservation.",
  },
] as const;

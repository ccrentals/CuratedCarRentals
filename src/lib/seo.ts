import type { Metadata } from "next";

export const SITE_URL = "https://curatedcarrentals.com";
export const SITE_NAME = "Curated Car Rentals";
export const DEFAULT_OG_IMAGE = "/live-site/home/hero-tropical-car.jpg";

export type PublicPageMetadataInput = {
  title: string;
  description: string;
  path: string;
  image?: string;
};

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export function publicPageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
}: PublicPageMetadataInput): Metadata {
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      locale: "en_JM",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      images: [
        {
          url: imageUrl,
          alt: `${SITE_NAME} in Kingston, Jamaica`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export const privatePageMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

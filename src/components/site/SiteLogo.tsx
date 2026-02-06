"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

type SiteLogoProps = {
  size?: number;
  className?: string;
};

const LOGO_LIGHT_SRC = "/logo-light.svg";
const LOGO_DARK_SRC = "/logo-dark.svg";
const FALLBACK_SRC = "/globe.svg";

export function SiteLogo({ size = 40, className }: SiteLogoProps) {
  const [lightSrc, setLightSrc] = useState(LOGO_LIGHT_SRC);
  const [darkSrc, setDarkSrc] = useState(LOGO_DARK_SRC);

  return (
    <span className={cn("relative inline-flex items-center justify-center", className)}>
      <Image
        src={lightSrc}
        alt="Curated Car Rentals logo"
        width={size}
        height={size}
        className="logo-light-img"
        onError={() => setLightSrc(FALLBACK_SRC)}
        priority
      />
      <Image
        src={darkSrc}
        alt="Curated Car Rentals logo"
        width={size}
        height={size}
        className="logo-dark-img"
        onError={() => setDarkSrc(FALLBACK_SRC)}
      />
    </span>
  );
}

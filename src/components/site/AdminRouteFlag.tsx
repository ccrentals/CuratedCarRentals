"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function AdminRouteFlag() {
  const pathname = usePathname();

  useEffect(() => {
    const isAdmin = pathname?.startsWith("/admin");
    document.documentElement.setAttribute("data-admin", isAdmin ? "true" : "false");
  }, [pathname]);

  return null;
}

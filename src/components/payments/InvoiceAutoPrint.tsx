"use client";

import { useEffect } from "react";

export default function InvoiceAutoPrint() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.print();
    }, 120);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}

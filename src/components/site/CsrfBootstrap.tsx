"use client";

import { useEffect } from "react";

export function CsrfBootstrap() {
  useEffect(() => {
    fetch("/api/security/csrf", { method: "GET", credentials: "include" }).catch(() => {
      // Best-effort only.
    });
  }, []);

  return null;
}

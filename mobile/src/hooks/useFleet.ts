import { useCallback, useEffect, useMemo, useState } from "react";

import { vehicles as bundledVehicles, type Vehicle } from "@/data/catalog";
import { fetchVehicles, type AvailabilityWindow } from "@/services/api";

type FleetState = {
  vehicles: Vehicle[];
  loading: boolean;
  source: "live" | "bundled";
  error: string | null;
};

const cache = new Map<string, { vehicles: Vehicle[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

export function useFleet(window?: AvailabilityWindow) {
  const cacheKey = useMemo(() => window ? JSON.stringify(window) : "all", [window]);
  const [revision, setRevision] = useState(0);
  const cached = cache.get(cacheKey);
  const [state, setState] = useState<FleetState>({
    vehicles: cached?.vehicles ?? bundledVehicles,
    loading: !cached,
    source: cached ? "live" : "bundled",
    error: null,
  });

  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const current = cache.get(cacheKey);
    if (revision === 0 && current && Date.now() - current.fetchedAt < CACHE_TTL_MS) {
      return () => { active = false; };
    }

    void fetchVehicles(window)
      .then((vehicles) => {
        if (!active) return;
        if (vehicles.length === 0) {
          setState({ vehicles: [], loading: false, source: "live", error: null });
          return;
        }
        cache.set(cacheKey, { vehicles, fetchedAt: Date.now() });
        setState({ vehicles, loading: false, source: "live", error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unable to load the live fleet.";
        setState((previous) => ({ ...previous, loading: false, source: "bundled", error: message }));
      });

    return () => { active = false; };
  }, [cacheKey, revision, window]);

  return { ...state, refresh };
}

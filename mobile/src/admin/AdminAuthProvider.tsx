import type { TokenCache } from "@clerk/expo";
import Constants, { AppOwnership } from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { API_BASE_URL, ApiError } from "@/services/api";
import { isAdminRole, type AdminRole } from "@/admin/capabilities";
import { buildAdminAssetSource } from "@/admin/assetSource";

const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 15_000;

type ClerkExpoModule = typeof import("@clerk/expo");

function getClerkExpo() {
  // Clerk's native module is intentionally loaded only outside Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@clerk/expo") as ClerkExpoModule;
}

export const isExpoGoRuntime = Constants.appOwnership === AppOwnership.Expo;
export const adminAuthUnavailableReason = isExpoGoRuntime
  ? "The staff workspace requires the installed Android app. Expo Go does not include Clerk's secure native module."
  : "Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to enable staff sign-in.";

const tokenCache: TokenCache = {
  async getToken(key) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async clearToken(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

export type NativeAdminUser = {
  id: string;
  publicId: string | null;
  email: string;
  role: AdminRole;
  fullName: string | null;
  username: string | null;
};

type NativeAdminSession = {
  accessToken: string;
  expiresAt: number;
  user: NativeAdminUser;
};

export type AdminAuthStatus =
  | "config_missing"
  | "loading"
  | "signed_out"
  | "exchanging"
  | "ready"
  | "forbidden"
  | "error";

type AdminAuthContextValue = {
  status: AdminAuthStatus;
  user: NativeAdminUser | null;
  error: string;
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  assetSource: (url: string) => { uri: string; headers?: Record<string, string> };
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function responseError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("The secure admin service took too long to respond.", 408);
    }
    throw new ApiError("Unable to reach the secure admin service. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

function UnavailableProvider({ children }: PropsWithChildren) {
  const unavailable = useCallback(async () => false, []);
  const signOut = useCallback(async () => {}, []);
  const request = useCallback(async () => {
    throw new ApiError(adminAuthUnavailableReason, 503);
  }, []);
  const assetSource = useCallback((url: string) => buildAdminAssetSource(url, null, API_BASE_URL), []);
  const value = useMemo<AdminAuthContextValue>(() => ({
    status: "config_missing",
    user: null,
    error: adminAuthUnavailableReason,
    refresh: unavailable,
    signOut,
    request,
    assetSource,
  }), [assetSource, request, signOut, unavailable]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

function AdminSessionBridge({ children }: PropsWithChildren) {
  const { useAuth, useClerk } = getClerkExpo();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [status, setStatus] = useState<AdminAuthStatus>("loading");
  const [session, setSession] = useState<NativeAdminSession | null>(null);
  const [error, setError] = useState("");
  const exchangePromise = useRef<Promise<NativeAdminSession | null> | null>(null);

  const exchange = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setSession(null);
      setStatus(isLoaded ? "signed_out" : "loading");
      return null;
    }
    if (exchangePromise.current) return exchangePromise.current;

    const pending = (async () => {
      await Promise.resolve();
      setStatus("exchanging");
      setError("");
      try {
        const clerkToken = await getToken();
        if (!clerkToken) throw new ApiError("Your staff sign-in expired. Please sign in again.", 401);
        const response = await fetchWithTimeout(`${API_BASE_URL}/api/mobile/admin/session`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${clerkToken}`,
          },
        });
        const data = await response.json().catch(() => null) as {
          accessToken?: unknown;
          expiresAt?: unknown;
          user?: Partial<NativeAdminUser>;
          error?: unknown;
        } | null;

        if (!response.ok) {
          const message = responseError(data, "Unable to authorize this staff account.");
          setStatus(response.status === 403 ? "forbidden" : "error");
          setError(message);
          setSession(null);
          return null;
        }

        const user = data?.user;
        if (
          typeof data?.accessToken !== "string" ||
          typeof data.expiresAt !== "number" ||
          !user ||
          typeof user.id !== "string" ||
          typeof user.email !== "string" ||
          !isAdminRole(user.role)
        ) {
          throw new ApiError("The admin service returned an invalid session.", 502);
        }

        const nextSession: NativeAdminSession = {
          accessToken: data.accessToken,
          expiresAt: data.expiresAt,
          user: {
            id: user.id,
            publicId: typeof user.publicId === "string" ? user.publicId : null,
            email: user.email,
            role: user.role,
            fullName: typeof user.fullName === "string" ? user.fullName : null,
            username: typeof user.username === "string" ? user.username : null,
          },
        };
        setSession(nextSession);
        setStatus("ready");
        return nextSession;
      } catch (exchangeError) {
        setSession(null);
        setStatus("error");
        setError(exchangeError instanceof Error ? exchangeError.message : "Unable to authorize this staff account.");
        return null;
      } finally {
        exchangePromise.current = null;
      }
    })();

    exchangePromise.current = pending;
    return pending;
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const task = setTimeout(() => void exchange(), 0);
    return () => clearTimeout(task);
  }, [exchange, isLoaded, isSignedIn]);

  const refresh = useCallback(async () => Boolean(await exchange()), [exchange]);

  const signOut = useCallback(async () => {
    setSession(null);
    setError("");
    await clerk.signOut();
    setStatus("signed_out");
  }, [clerk]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    let activeSession = session;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!activeSession || activeSession.expiresAt <= nowSeconds + 30) {
      activeSession = await exchange();
    }
    if (!activeSession) throw new ApiError(error || "Staff authorization is required.", 401);

    const send = (token: string) => fetchWithTimeout(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    let response = await send(activeSession.accessToken);
    if (response.status === 401) {
      setSession(null);
      const refreshed = await exchange();
      if (refreshed) response = await send(refreshed.accessToken);
    }
    return response;
  }, [error, exchange, session]);

  const assetSource = useCallback((url: string) => buildAdminAssetSource(url, session?.accessToken ?? null, API_BASE_URL), [session]);

  const visibleStatus: AdminAuthStatus = !isLoaded
    ? "loading"
    : !isSignedIn
      ? "signed_out"
      : status;

  const value = useMemo<AdminAuthContextValue>(() => ({
    status: visibleStatus,
    user: isSignedIn ? session?.user ?? null : null,
    error,
    refresh,
    signOut,
    request,
    assetSource,
  }), [assetSource, error, isSignedIn, refresh, request, session?.user, signOut, visibleStatus]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function AdminAuthProvider({ children }: PropsWithChildren) {
  if (!isAdminAuthConfigured) {
    return <UnavailableProvider>{children}</UnavailableProvider>;
  }
  const { ClerkProvider } = getClerkExpo();
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      <AdminSessionBridge>{children}</AdminSessionBridge>
    </ClerkProvider>
  );
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return value;
}

export const isAdminAuthConfigured = Boolean(clerkPublishableKey) && !isExpoGoRuntime;

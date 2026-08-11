import { redirect } from "next/navigation";

import { canAccessAdmin } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import { loadPrimaryAdminLoginPath } from "@/lib/auth/adminLoginMethod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildRedirectQuery(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const query = new URLSearchParams();

  const errorValue = searchParams.error;
  if (typeof errorValue === "string" && errorValue.trim()) {
    query.set("error", errorValue.trim());
  }

  const redirectValue = searchParams.redirect;
  if (typeof redirectValue === "string" && redirectValue.startsWith("/")) {
    query.set("redirect", redirectValue);
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

function resolveRedirectTarget(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const redirectValue = searchParams.redirect;
  if (typeof redirectValue === "string" && redirectValue.startsWith("/")) {
    if (
      redirectValue === "/admin/auth" ||
      redirectValue.startsWith("/admin/auth?") ||
      redirectValue === "/sign-in" ||
      redirectValue.startsWith("/sign-in?") ||
      redirectValue === "/api/admin/session/bootstrap" ||
      redirectValue.startsWith("/api/admin/session/bootstrap?")
    ) {
      return "/admin";
    }
    return redirectValue;
  }

  return "/admin";
}

function buildSignInHref(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const redirectTarget = resolveRedirectTarget(searchParams);
  const query = new URLSearchParams();
  query.set("redirect", redirectTarget);

  const errorValue = searchParams.error;
  if (typeof errorValue === "string" && errorValue.trim()) {
    query.set("error", errorValue.trim());
  }

  const queryString = query.toString();
  return queryString ? `/sign-in?${queryString}` : "/sign-in";
}

function buildBootstrapHref(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const redirectTarget = resolveRedirectTarget(searchParams);
  const query = new URLSearchParams();
  query.set("redirect", redirectTarget);
  return `/api/admin/session/bootstrap?${query.toString()}`;
}

export default async function AdminAuthEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const primaryLoginPath = await loadPrimaryAdminLoginPath();
  const query = buildRedirectQuery(params);
  const redirectTarget = resolveRedirectTarget(params);
  const bootstrapRequested = params.bootstrap === "1";

  const activeSession = await getSessionFromRequest();
  if (activeSession && canAccessAdmin(activeSession.role)) {
    redirect(redirectTarget);
  }

  if (primaryLoginPath !== "/sign-in") {
    redirect(`${primaryLoginPath}${query}`);
  }

  if (typeof params.error === "string" && params.error.trim()) {
    redirect(`${primaryLoginPath}${query}`);
  }

  if (bootstrapRequested) {
    redirect(buildBootstrapHref(params));
  }

  redirect(buildSignInHref(params));
}

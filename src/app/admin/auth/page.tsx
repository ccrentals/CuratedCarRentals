import { redirect } from "next/navigation";

import { loadPrimaryAdminLoginMethodResolution } from "@/lib/auth/adminLoginMethod";

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

export default async function AdminAuthEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const resolution = await loadPrimaryAdminLoginMethodResolution();
  const primaryLoginPath =
    resolution.method === "legacy" ? "/admin/login" : "/sign-in";
  const query = buildRedirectQuery(params);
  redirect(`${primaryLoginPath}${query}`);
}

import { redirect } from "next/navigation";

import { loadPrimaryAdminLoginPath } from "@/lib/auth/adminLoginMethod";

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
  const primaryLoginPath = await loadPrimaryAdminLoginPath();
  const query = buildRedirectQuery(params);
  redirect(`${primaryLoginPath}${query}`);
}

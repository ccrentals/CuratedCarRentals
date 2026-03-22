import { redirect } from "next/navigation";

import { AdminMessagesPageContent } from "@/components/admin/AdminMessagesPageContent";
import { normalizeContactMessageStatusFilter } from "@/lib/messages/adminMessages";

type SearchParams = Record<string, string | string[] | undefined>;

function buildTrashHref(params: SearchParams) {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string" || key === "status") continue;
    nextParams.set(key, value);
  }
  const qs = nextParams.toString();
  return qs ? `/admin/messages/trash?${qs}` : "/admin/messages/trash";
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = normalizeContactMessageStatusFilter(
    typeof params.status === "string" ? params.status : undefined,
  );

  if (status === "ARCHIVED") {
    redirect(buildTrashHref(params));
  }

  return <AdminMessagesPageContent searchParams={params} viewMode="inbox" />;
}

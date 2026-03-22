import { AdminMessagesPageContent } from "@/components/admin/AdminMessagesPageContent";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminMessagesTrashPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <AdminMessagesPageContent searchParams={params} viewMode="trash" />;
}

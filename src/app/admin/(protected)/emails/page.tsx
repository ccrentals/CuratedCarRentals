import { AdminEmailsPageContent } from "@/components/admin/AdminEmailsPageContent";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminEmailsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <AdminEmailsPageContent searchParams={params} />;
}

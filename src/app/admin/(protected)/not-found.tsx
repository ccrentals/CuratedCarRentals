import { NotFoundHero } from "@/components/shared/NotFoundHero";

export default function AdminProtectedNotFound() {
  return <NotFoundHero homeHref="/admin" homeLabel="Go Back" />;
}

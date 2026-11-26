import { redirect } from "next/navigation";
/** Search was replaced by the site-wide AI chat on the home page (a query is carried over as the first question). */
export default async function Buscar({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q;
  redirect(typeof q === "string" && q.trim() ? `/?q=${encodeURIComponent(q.trim().slice(0, 500))}` : "/");
}

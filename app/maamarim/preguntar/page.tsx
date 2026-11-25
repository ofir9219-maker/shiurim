import MaamarChat from "@/components/maamarim/MaamarChat";
import { getMaamar } from "@/lib/maamarim/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preguntar a los maamarim" };

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const m = typeof sp.m === "string" ? getMaamar(sp.m) : null;
  return <MaamarChat key={m?.id ?? "all"} scope={m ? { id: m.id, title: m.title } : undefined} />;
}

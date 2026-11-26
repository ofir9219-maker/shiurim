import AgentChat from "@/components/agent/AgentChat";
import { getMaamar } from "@/lib/maamarim/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preguntar a los maamarim" };

/** Same site-wide agent, limited to the library (or to one maamar with ?m=). */
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const m = typeof sp.m === "string" ? getMaamar(sp.m) : null;
  return m ? <AgentChat key={m.id} scope={{ type: "maamar", id: m.id, title: m.title }} /> : <AgentChat key="maamarim" scope={{ type: "maamarim" }} />;
}

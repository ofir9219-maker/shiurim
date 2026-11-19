import ChampinonesApp from "../../components/champinones/ChampinonesApp";

export const metadata = {
  title: "Champiñones",
  description: "Conexiones textuales entre pasajes de la Guemará, verificadas contra Sefaria y los shiurim, con mapa visual y profundidad.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const sp = await searchParams;
  return <ChampinonesApp initialClassId={typeof sp.class === "string" ? sp.class : undefined} />;
}

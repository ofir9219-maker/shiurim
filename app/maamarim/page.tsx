import Library from "@/components/maamarim/Library";
import { categoryTree, listCards } from "@/lib/maamarim/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maamarim — biblioteca", description: "Biblioteca digital de maamarim ordenada por catálogo, con búsqueda por IA." };

export default function MaamarimPage() {
  return <Library cards={listCards()} tree={categoryTree()} />;
}

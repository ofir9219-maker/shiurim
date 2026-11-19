import { Suspense } from "react";
import SearchView from "../../components/SearchView";

export const metadata = { title: "Buscar" };
export default function Buscar() {
  return <Suspense fallback={null}><SearchView /></Suspense>;
}

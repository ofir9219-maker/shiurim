import { Suspense } from "react";
import ShiurView from "../../../components/ShiurView";

export default async function ShiurPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<p className="muted">Cargando…</p>}><ShiurView id={id} /></Suspense>;
}

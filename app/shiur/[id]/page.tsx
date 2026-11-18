import { Suspense } from "react";
import type { Metadata } from "next";
import ShiurView from "../../../components/ShiurView";
import { ShiurSkeleton } from "../../../components/ShiurView";
import { getClass } from "../../../lib/db";
import { cleanTitle } from "../../../components/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const row = getClass(id);
    if (row) {
      const title = cleanTitle(row.title);
      const description = row.summary ? row.summary.slice(0, 200) : undefined;
      return { title, description, openGraph: { title, description, type: "article" } };
    }
  } catch {}
  return { title: "Clase" };
}

export default async function ShiurPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<ShiurSkeleton />}><ShiurView id={id} /></Suspense>;
}

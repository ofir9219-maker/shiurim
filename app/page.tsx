import { listClasses, rowToClass } from "../lib/db";
import { audioUrlFor } from "../lib/audio";
import ClassList from "../components/ClassList";
import type { ClassSummary } from "../components/format";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "ברכות שר לשמחה — Shiurim de Berajot" } };

export default async function Home() {
  const rows = listClasses({ collection: "berajot" });
  const classes = (await Promise.all(rows.map(async (r) => rowToClass(r, await audioUrlFor(r.id, r.r2_key))))) as ClassSummary[];
  return <ClassList classes={classes} />;
}

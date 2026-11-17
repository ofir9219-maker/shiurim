import { listClasses, rowToClass } from "../lib/db";
import { audioUrlFor } from "../lib/audio";
import ClassList from "../components/ClassList";
import type { ClassSummary } from "../components/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = listClasses();
  const classes = (await Promise.all(rows.map(async (r) => rowToClass(r, await audioUrlFor(r.id, r.r2_key))))) as ClassSummary[];
  return (
    <>
      <h1 className="page-title he" dir="rtl" lang="he">ברכות שר לשמחה</h1>
      <p className="lead">Shiurim de Guemará, ordenados por clase. Elegí una para escucharla con la transcripción sincronizada.</p>
      <ClassList classes={classes} />
    </>
  );
}

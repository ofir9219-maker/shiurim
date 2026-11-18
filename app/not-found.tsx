import Link from "next/link";
export const metadata = { title: "No encontrada" };
export default function NotFound() {
  return (
    <div className="state">
      <div className="glyph" lang="he" dir="rtl" aria-hidden="true">אין</div>
      <h2>Página no encontrada</h2>
      <p>La página que buscas no existe o fue movida. Vuelve a la lista de clases.</p>
      <Link href="/" className="btn">Ver los shiurim</Link>
    </div>
  );
}

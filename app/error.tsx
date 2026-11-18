"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state" role="alert">
      <div className="glyph" lang="he" dir="rtl" aria-hidden="true">!</div>
      <h2>Algo salió mal</h2>
      <p>No pudimos cargar esta página. Probá de nuevo en un momento.</p>
      <button className="btn" onClick={reset}>Reintentar</button>
    </div>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="hero">
        <div className="skeleton" style={{ height: 70, maxWidth: 420, margin: "0 auto 18px" }} />
        <div className="skeleton" style={{ height: 18, maxWidth: 520, margin: "0 auto 10px" }} />
        <div className="skeleton" style={{ height: 18, maxWidth: 380, margin: "0 auto" }} />
      </div>
      <ul className="cards">{Array.from({ length: 6 }).map((_, i) => <li key={i}><div className="card" style={{ height: 190 }}><div className="skeleton" style={{ height: 22, width: "35%" }} /><div className="skeleton" style={{ height: 30, width: "80%", marginLeft: "auto" }} /><div className="skeleton" style={{ height: 16 }} /><div className="skeleton" style={{ height: 16, width: "70%" }} /></div></li>)}</ul>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

const KEY = "maamar-font-v1";
export default function ReaderTools() {
  const [size, setSize] = useState(1.22);
  useEffect(() => { try { const v = Number(localStorage.getItem(KEY)); if (v >= 0.95 && v <= 1.8) setSize(v); } catch { /* ignore */ } }, []);
  useEffect(() => {
    document.querySelector<HTMLElement>(".mm-doc")?.style.setProperty("--mm-size", `${size}rem`);
    try { localStorage.setItem(KEY, String(size)); } catch { /* ignore */ }
  }, [size]);
  // Citation links (#s2-b3 / #fn-4): center and highlight the cited paragraph (client navigation does not apply :target)
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
      const el = document.getElementById(id); if (!el) return;
      document.querySelectorAll(".mm-hit").forEach((x) => x.classList.remove("mm-hit"));
      el.classList.add("mm-hit");
      setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    };
    go(); window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return (
    <>
      <div className="mm-size" role="group" aria-label="Tamaño de letra">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setSize((s) => Math.max(0.95, +(s - 0.08).toFixed(2)))} aria-label="Letra más pequeña">א−</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setSize((s) => Math.min(1.8, +(s + 0.08).toFixed(2)))} aria-label="Letra más grande">א+</button>
      </div>
      <button type="button" className="btn-ghost btn-sm" onClick={() => window.print()}>Imprimir</button>
    </>
  );
}

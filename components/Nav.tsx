"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

const items = [
  { href: "/", label: "Shiurim" },
  { href: "/buscar", label: "Buscar" },
  { href: "/chat", label: "Preguntar" },
];

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("shiurim:theme", next); } catch {}
    setDark(!dark);
  };
  return (
    <button className="theme-toggle" onClick={flip} aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"} title={dark ? "Tema claro" : "Estudio nocturno"}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export default function Nav() {
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="header-in">
        <Link href="/" className="brand" aria-label="ברכות שר לשמחה — inicio">
          <span className="brand-he he" dir="rtl" lang="he">ברכות שר לשמחה</span>
          <span className="brand-es">Shiurim de Guemará</span>
        </Link>
        <nav className="nav" aria-label="Principal">
          {items.map((i) => {
            const on = i.href === "/" ? path === "/" || path.startsWith("/shiur") : path.startsWith(i.href);
            return <Link key={i.href} href={i.href} className={on ? "navlink on" : "navlink"} aria-current={on ? "page" : undefined}>{i.label}</Link>;
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}

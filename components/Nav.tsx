"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Shiurim" },
  { href: "/buscar", label: "Buscar" },
  { href: "/chat", label: "Preguntar" },
];
export default function Nav() {
  const path = usePathname();
  return (
    <header className="site-header">
      <Link href="/" className="brand he" dir="rtl" lang="he">ברכות שר לשמחה</Link>
      <nav aria-label="Principal">
        {items.map((i) => {
          const on = i.href === "/" ? path === "/" || path.startsWith("/shiur") : path.startsWith(i.href);
          return <Link key={i.href} href={i.href} className={on ? "navlink on" : "navlink"}>{i.label}</Link>;
        })}
      </nav>
    </header>
  );
}

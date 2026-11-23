"use client";
// Minimal, safe Markdown for chat answers: headings, paragraphs, lists, blockquotes, **bold**, *italic*, `code`, --- and [n] citations.
import { Fragment, type ReactNode } from "react";

type Props = { text: string; onCite?: (n: number) => void; maxCite?: number };

function inline(s: string, key: string, onCite?: (n: number) => void, maxCite = 99): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[(\d{1,2})\])/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{inline(m[2], k, onCite, maxCite)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) {
      const n = Number(m[5]);
      out.push(n >= 1 && n <= maxCite && onCite
        ? <button key={k} type="button" className="mm-cite" onClick={() => onCite(n)} aria-label={`Fuente ${n}`}>{n}</button>
        : <Fragment key={k}>[{n}]</Fragment>);
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function Markdown({ text, onCite, maxCite }: Props) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = Math.min(4, h[1].length + 1); const Tag = `h${lvl}` as "h2"; blocks.push(<Tag key={k++} dir="auto">{inline(h[2], `h${k}`, onCite, maxCite)}</Tag>); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={k++} />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++} dir="auto">{inline(buf.join(" "), `q${k}`, onCite, maxCite)}</blockquote>);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let it = lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) it += " " + lines[i++].trim();
        items.push(it);
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++}>{items.map((t, j) => <li key={j} dir="auto">{inline(t, `l${k}-${j}`, onCite, maxCite)}</li>)}</L>);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*([-*•]|\d+[.)])\s+|-{3,}$)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={k++} dir="auto">{buf.flatMap((b, j) => (j ? [<br key={`br${j}`} />, ...inline(b, `p${k}-${j}`, onCite, maxCite)] : inline(b, `p${k}-${j}`, onCite, maxCite)))}</p>);
  }
  return <div className="mm-md">{blocks}</div>;
}

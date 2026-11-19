// Pure HTML renderer for a Champiñones analysis. The same markup powers the in-app view (injected into .champ,
// styled by the site tokens) and the self-contained "Descargar HTML" file (inline CSS + tokens + tiny script).
import { normHe, heTokens, findHook, fmtMs } from "./text";
import { tr, moveLabel, hookLabel } from "./i18n";
import type { Analysis, Node, Link, Meta } from "./types";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const sefariaUrl = (ref: string) => "https://www.sefaria.org/" + encodeURIComponent(ref.replace(/ /g, "_")).replace(/%3A/gi, ":").replace(/%2C/gi, ",") + "?lang=bi";

/** Wrap the words of `hook` found inside `excerpt` with <mark class="hk">. Returns escaped HTML. */
export function highlightHook(excerpt: string, hook: string): string {
  const raw = excerpt.split(/\s+/).filter(Boolean);
  const idxOfTok: number[] = [], toks: string[] = [];
  raw.forEach((w, i) => normHe(w).split(" ").filter(Boolean).forEach((t) => { toks.push(t); idxOfTok.push(i); }));
  const pos = findHook(hook, toks.join(" "));
  if (pos < 0) return raw.map(esc).join(" ");
  const k = heTokens(hook).length;
  const a = idxOfTok[pos], b = idxOfTok[Math.min(toks.length - 1, pos + k - 1)];
  return raw.map((w, i) => (i === a ? '<mark class="hk">' : "") + esc(w) + (i === b ? "</mark>" : "")).join(" ");
}

const WORK_COLOR: Record<string, string> = {
  Bavli: "var(--gold)", Yerushalmi: "var(--gold)", Mishnah: "var(--gold)", Tanakh: "#4f7fc4", Midrash: "#5b9a78", Rashi: "#5b9a78", Tosafot: "#5b9a78",
  "Likutei Moharan": "#9170c0", Zohar: "#9170c0", Other: "var(--muted)",
};

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }

// ---------- SVG map ----------
function clipToRect(cx: number, cy: number, w: number, h: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(dx ? (w / 2) / Math.abs(dx) : Infinity, dy ? (h / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

export function renderMap(a: Analysis, lang: string): string {
  const nodes = a.nodes;
  if (!nodes.length) return "";
  const deg = new Map<string, number>(); a.links.forEach((l) => { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); });
  let anchors = nodes.filter((n) => n.role === "anchor");
  if (!anchors.length) anchors = [[...nodes].sort((x, y) => (deg.get(y.id) || 0) - (deg.get(x.id) || 0))[0]];
  anchors = anchors.slice(0, 3);
  const others = nodes.filter((n) => !anchors.includes(n));
  const NW = 178, NH = 56;
  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.length <= 5) {
    // compact "tree": anchors on the top row, the rest in a row below (edges between neighbours stay horizontal)
    const GAP = 150, ROW = 150;
    const row = (ns: Node[], y: number) => ns.forEach((n, i) => pos.set(n.id, { x: (i - (ns.length - 1) / 2) * (NW + GAP), y }));
    if (others.length) { row(anchors, 0); row(others, ROW); } else row(anchors, 0);
  } else {
    const rx = 400, ry = others.length > 4 ? 190 : 150;
    anchors.forEach((n, i) => pos.set(n.id, { x: (i - (anchors.length - 1) / 2) * (NW + 60), y: 0 }));
    others.forEach((n, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
      pos.set(n.id, { x: rx * Math.cos(ang), y: ry * Math.sin(ang) });
    });
  }
  const pairCount = new Map<string, number>();
  const edges = a.links.map((l) => {
    const p = pos.get(l.from), q = pos.get(l.to);
    if (!p || !q) return "";
    const key = [l.from, l.to].sort().join("|"); const k = pairCount.get(key) || 0; pairCount.set(key, k + 1);
    const [x1, y1] = clipToRect(p.x, p.y, NW, NH, q.x, q.y), [x2, y2] = clipToRect(q.x, q.y, NW, NH, p.x, p.y);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 46;
    const qx = mx + (nx / nl) * off, qy = my + (ny / nl) * off;
    const lx = 0.25 * x1 + 0.5 * qx + 0.25 * x2, ly = 0.25 * y1 + 0.5 * qy + 0.25 * y2;
    const sw = l.strength === 3 ? 5.5 : l.strength === 2 ? 3.2 : 1.7;
    const dash = l.strength === 1 ? ' stroke-dasharray="6 5"' : "";
    const label = trunc(l.hook_text, 22), lw = Math.max(46, label.length * 10 + 18);
    return `<g class="cm-edge" data-link="${esc(l.id)}" data-a="${esc(l.from)}" data-b="${esc(l.to)}" tabindex="0" role="button" aria-label="${esc(l.hook_text + " — " + hookLabel(lang, l.hook_type))}">
      <path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" class="cm-hit" fill="none"/>
      <path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" class="cm-line" fill="none" stroke-width="${sw}"${dash} stroke-linecap="round"/>
      <rect x="${(lx - lw / 2).toFixed(1)}" y="${(ly - 15).toFixed(1)}" width="${lw}" height="30" rx="15" class="cm-pill"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" text-anchor="middle" class="cm-hook" direction="rtl">${esc(label)}</text></g>`;
  }).join("");
  const boxes = nodes.map((n) => {
    const p = pos.get(n.id)!;
    const isA = anchors.includes(n);
    return `<g class="cm-node${isA ? " anchor" : ""}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.label + " — " + n.ref)}" transform="translate(${(p.x - NW / 2).toFixed(1)} ${(p.y - NH / 2).toFixed(1)})">
      <title>${esc(n.label + " · " + n.ref)}</title>
      <rect width="${NW}" height="${NH}" rx="12" class="cm-box" style="stroke:${WORK_COLOR[n.work] || "var(--gold)"}" stroke-width="${isA ? 3 : 1.6}"/>
      <text x="${NW / 2}" y="23" text-anchor="middle" class="cm-label">${esc(trunc(n.label, 24))}</text>
      <text x="${NW / 2}" y="41" text-anchor="middle" class="cm-ref">${esc(trunc(n.ref, 26))}</text></g>`;
  }).join("");
  const xs = [...pos.values()].map((p) => p.x), ys = [...pos.values()].map((p) => p.y);
  const PAD = 56, vx = Math.min(...xs) - NW / 2 - PAD, vy = Math.min(...ys) - NH / 2 - PAD / 1.6;
  const vw = Math.max(...xs) - Math.min(...xs) + NW + 2 * PAD, vh = Math.max(...ys) - Math.min(...ys) + NH + PAD * 1.25;
  return `<svg class="cmap" viewBox="${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}" style="max-width:${Math.round(vw * 1.25)}px;min-width:min(100%,${Math.min(Math.round(vw), 560)}px)" role="img" aria-label="${esc(tr(lang, "map"))}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${edges}${boxes}</svg>`;
}

// ---------- sections ----------
const dots = (n: number) => "●".repeat(n) + '<span class="off">' + "●".repeat(3 - n) + "</span>";

function shiurChip(a: Analysis, i: number, o: RenderOpts): string {
  const s = a.shiur_refs[i]; if (!s) return "";
  const href = `${o.origin || ""}/shiur/${encodeURIComponent(s.classId)}?t=${Math.floor(s.startMs / 1000)}`;
  const t = fmtMs(s.startMs);
  return `<div class="sh"><button type="button" class="sh-play${o.standalone ? " off" : ""}" data-play data-class="${esc(s.classId)}" data-ms="${s.startMs}" aria-label="${esc(tr(a.answer_language, "listen") + " " + t)}">▶</button>
    <div class="sh-b"><a class="sh-t" href="${esc(href)}"${o.standalone ? ' target="_blank" rel="noopener"' : ""}><span class="tnum">${esc(tr(a.answer_language, "class"))} ${esc(s.ordLabel || "")} · ${t}</span>${s.title ? `<span class="sh-n he" dir="auto">${esc(trunc(s.title.replace(/^\d+\.\s*/, ""), 80))}</span>` : ""}</a><p>${esc(s.why)}</p></div></div>`;
}

export type RenderOpts = { origin?: string; standalone?: boolean };
type R = { id?: string; question?: string; data: Analysis; meta?: Meta };

export function renderBody(res: R, o: RenderOpts = {}): string {
  const a = res.data, L = a.answer_language || "es", T = (k: string) => esc(tr(L, k));
  const byId = new Map(a.nodes.map((n) => [n.id, n]));
  const nodeCard = (n: Node) => `<article class="pcard" data-node="${esc(n.id)}" style="--wc:${WORK_COLOR[n.work] || "var(--gold)"}">
    <header><span class="pill role-${esc(n.role)}">${T("role_" + n.role)}</span><span class="pill work">${esc(n.work)}</span></header>
    <h3>${esc(n.label)}</h3>
    <a class="ref" href="${sefariaUrl(n.ref)}" target="_blank" rel="noopener">${esc(n.ref)} <span aria-hidden="true">↗</span><span class="sr-only"> ${T("sefaria")}</span></a>
    <p class="hx he" dir="rtl" lang="he">${esc(n.hebrew_excerpt)}</p>
    ${n.transliteration ? `<p class="tl">${esc(n.transliteration)}</p>` : ""}
    <p class="tn">${esc(n.translation)}</p></article>`;
  const linkCard = (l: Link) => {
    const A = byId.get(l.from)!, B = byId.get(l.to)!;
    const ex = (n: Node) => `<div class="lx"><button type="button" class="nlink" data-focus-node="${esc(n.id)}">${esc(trunc(n.label, 40))}</button><p class="he" dir="rtl" lang="he">${highlightHook(n.hebrew_excerpt, l.hook_text)}</p></div>`;
    const sh = l.shiur_ref_indexes.map((i) => shiurChip(a, i, o)).join("");
    return `<article class="lcard" data-link="${esc(l.id)}" data-a="${esc(l.from)}" data-b="${esc(l.to)}">
      <header class="lh"><div class="hk-big he" dir="rtl" lang="he"><mark class="hk">${esc(l.hook_text)}</mark></div>
        <div class="hk-meta">${l.hook_transliteration ? `<i>${esc(l.hook_transliteration)}</i> · ` : ""}<b>${esc(l.hook_gloss)}</b></div>
        <div class="hk-tags"><span class="pill">${esc(hookLabel(L, l.hook_type))}</span><span class="str s${l.strength}" title="${T("strength")}: ${T("s" + l.strength)}"><span class="dots" aria-hidden="true">${dots(l.strength)}</span> ${T("s" + l.strength)}</span></div></header>
      <div class="lxs">${ex(A)}${ex(B)}</div>
      <div class="sd"><section class="surf"><h4>${T("surface")}</h4><p>${esc(l.surface_explanation)}</p></section>
      <section class="deep"><h4>${T("depth")}</h4><p>${esc(l.depth_explanation)}</p>
      ${l.depth_moves.length ? `<ul class="moves" aria-label="${T("moves")}">${l.depth_moves.map((m) => `<li>${esc(moveLabel(L, m))}</li>`).join("")}</ul>` : ""}</section></div>
      ${sh ? `<div class="shs"><h4>${T("shiurim")}</h4>${sh}</div>` : ""}</article>`;
  };
  const used = new Set(a.links.flatMap((l) => l.shiur_ref_indexes));
  const shAll = a.shiur_refs.map((_, i) => i);
  const meta = res.meta;
  return `<div class="champ-doc" data-lang="${esc(L)}">
  <header class="ch-head"><div class="eyebrow">${T("eyebrow")}</div><h1 class="ch-title" dir="auto">${esc(a.title)}</h1>
    ${res.question ? `<p class="ch-q" dir="auto">“${esc(res.question)}”</p>` : ""}
    <p class="ch-sum" dir="auto">${esc(a.summary)}</p></header>
  <div class="orn"><i></i></div>
  ${a.nodes.length ? `<section class="ch-sec" aria-labelledby="h-map"><div class="sec-h"><h2 id="h-map">${T("map")}</h2><span class="hint">${T("mapHint")} <button type="button" class="reset" data-reset>${T("reset")}</button></span></div>
    <div class="mapwrap card">${renderMap(a, L)}</div>
    <div class="legend"><span><i style="--c:var(--gold)"></i>Bavli</span><span><i style="--c:#4f7fc4"></i>Tanakh</span><span><i style="--c:#5b9a78"></i>Midrash · Rashi</span><span><i style="--c:#9170c0"></i>Likutei Moharan</span><span class="ln"><svg width="44" height="10"><line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" stroke-width="1.7" stroke-dasharray="6 5"/></svg>1</span><span class="ln"><svg width="44" height="10"><line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" stroke-width="3.2"/></svg>2</span><span class="ln"><svg width="44" height="10"><line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/></svg>3</span></div></section>` : ""}
  ${a.nodes.length ? `<section class="ch-sec" aria-labelledby="h-pas"><div class="sec-h"><h2 id="h-pas">${T("passages")}</h2></div><div class="pgrid">${a.nodes.map(nodeCard).join("")}</div></section>` : ""}
  <section class="ch-sec" aria-labelledby="h-con"><div class="sec-h"><h2 id="h-con">${T("connections")}</h2></div>
    ${a.links.length ? a.links.map(linkCard).join("") : `<p class="muted empty">${T("noLinks")}</p>`}</section>
  ${a.layers.length ? `<section class="ch-sec" aria-labelledby="h-lay"><div class="sec-h"><h2 id="h-lay">${T("layers")}</h2></div>${a.layers.map((y, i) => `<details class="layer" data-nodes="${esc(y.node_ids.join(" "))}"${i < 2 ? " open" : ""}><summary><span class="pill k-${esc(y.kind)}">${esc(y.kind.replace("_", " "))}</span> ${esc(y.title)}</summary><p>${esc(y.text)}</p></details>`).join("")}</section>` : ""}
  <section class="ch-sec syn" aria-labelledby="h-syn"><div class="sec-h"><h2 id="h-syn">${T("synthesis")}</h2></div><p class="synthesis" dir="auto">${esc(a.synthesis)}</p>
    ${a.practical_lesson ? `<aside class="lesson"><h3>${T("lesson")}</h3><p dir="auto">${esc(a.practical_lesson)}</p></aside>` : ""}</section>
  ${shAll.length ? `<section class="ch-sec" aria-labelledby="h-sh"><div class="sec-h"><h2 id="h-sh">${T("shiurim")}</h2></div><div class="shlist">${shAll.map((i) => shiurChip(a, i, o)).join("")}</div></section>` : ""}
  ${a.open_questions.length ? `<section class="ch-sec quiet"><div class="sec-h"><h2>${T("openQ")}</h2></div><ul>${a.open_questions.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul></section>` : ""}
  ${a.caveats.length ? `<section class="ch-sec quiet"><div class="sec-h"><h2>${T("caveats")}</h2></div><ul>${a.caveats.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul></section>` : ""}
  <footer class="ch-foot">${meta ? `<span>${T("model")}: ${esc(meta.model)}${meta.effort ? " · " + esc(meta.effort) : ""}</span><span>${T("generated")}: ${esc(new Date(meta.createdAt).toISOString().slice(0, 10))}</span><span>${T("validated")}${meta.validation.dropped.length ? ` · ${meta.validation.dropped.length} ${T("discarded")}` : ""}</span>` : ""}<span>champinones-v1</span></footer></div>`;
}

/** Interaction script (plain JS source; run with new Function("root", src) in the app, inlined in the standalone file). */
export const INTERACT_JS = `
(function(root){
  var q=function(s,r){return Array.prototype.slice.call((r||root).querySelectorAll(s))};
  function clear(){root.removeAttribute("data-focus");q(".dim").forEach(function(e){e.classList.remove("dim")});q(".sel").forEach(function(e){e.classList.remove("sel")})}
  function focus(kind,id){
    clear(); root.setAttribute("data-focus",kind+":"+id);
    var nodes={},links={},first=null;
    if(kind==="n"){nodes[id]=1;q(".lcard,.cm-edge").forEach(function(e){if(e.dataset.a===id||e.dataset.b===id){links[e.dataset.link]=1;nodes[e.dataset.a]=1;nodes[e.dataset.b]=1}})}
    else{links[id]=1;var e=q('.lcard[data-link="'+id+'"]')[0];if(e){nodes[e.dataset.a]=1;nodes[e.dataset.b]=1}}
    q(".cm-node,.pcard").forEach(function(e){if(!nodes[e.dataset.node])e.classList.add("dim");else if(e.dataset.node===id&&kind==="n")e.classList.add("sel")});
    q(".cm-edge,.lcard").forEach(function(e){if(!links[e.dataset.link])e.classList.add("dim");else{if(kind==="l"&&e.dataset.link===id)e.classList.add("sel");if(!first&&e.classList.contains("lcard"))first=e}});
    q(".layer").forEach(function(e){var ids=(e.dataset.nodes||"").split(" ");if(kind==="n"&&ids.indexOf(id)<0)e.classList.add("dim")});
    var t=kind==="l"?first:(q('.pcard[data-node="'+id+'"]')[0]||first);
    if(t&&t.scrollIntoView)t.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  root.addEventListener("click",function(ev){
    var t=ev.target;if(!t.closest)return;
    if(t.closest("[data-reset]")){clear();return}
    var fn=t.closest("[data-focus-node]");if(fn){focus("n",fn.getAttribute("data-focus-node"));return}
    var n=t.closest(".cm-node");if(n){focus("n",n.dataset.node);return}
    var e=t.closest(".cm-edge");if(e){focus("l",e.dataset.link);return}
    var pc=t.closest(".pcard");if(pc&&!t.closest("a")){focus("n",pc.dataset.node);return}
  });
  root.addEventListener("keydown",function(ev){if(ev.key!=="Enter"&&ev.key!==" ")return;var t=ev.target;if(!t.closest)return;var n=t.closest(".cm-node"),e=t.closest(".cm-edge");if(n){ev.preventDefault();focus("n",n.dataset.node)}else if(e){ev.preventDefault();focus("l",e.dataset.link)}});
})(root);`;

export const CHAMP_CSS = `
.champ{--wc:var(--gold);color:var(--text);font-family:var(--font-read);font-size:1.08rem;line-height:1.65;max-width:var(--w-wide);margin:0 auto}
.champ *{box-sizing:border-box}
.champ h1,.champ h2,.champ h3,.champ h4{margin:0}
.champ .eyebrow{font:600 var(--fs-2xs)/1 var(--font-ui);letter-spacing:.18em;text-transform:uppercase;color:var(--gold-strong)}
.champ .ch-head{padding:var(--sp-5) 0 var(--sp-4)}
.champ .ch-title{font-family:var(--font-display);font-weight:600;font-size:var(--fs-2xl);line-height:var(--lh-tight);color:var(--ink);margin:10px 0 var(--sp-3);letter-spacing:-.005em;text-wrap:balance}
.champ .ch-q{margin:0 0 var(--sp-3);color:var(--muted);font-style:italic;font-size:var(--fs-md)}
.champ .ch-sum{margin:0;font-size:1.18rem;max-width:var(--w-read);color:var(--text)}
.champ .orn{display:flex;align-items:center;gap:12px;color:var(--gold);margin:var(--sp-3) 0 var(--sp-2)}
.champ .orn::before,.champ .orn::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--gold-line))}
.champ .orn::after{background:linear-gradient(270deg,transparent,var(--gold-line))}
.champ .orn>i{width:7px;height:7px;background:currentColor;transform:rotate(45deg);flex:none}
.champ .ch-sec{margin:var(--sp-6) 0}
.champ .sec-h{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;margin-bottom:var(--sp-3);border-bottom:1px solid var(--line);padding-bottom:8px}
.champ h2{font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);color:var(--ink);line-height:1.15}
.champ .hint{font:400 var(--fs-xs)/1.3 var(--font-ui);color:var(--muted)}
.champ .reset{font:inherit;color:var(--gold-strong);background:none;border:0;padding:4px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.champ .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--sh-1)}
.champ .mapwrap{padding:var(--sp-3);overflow-x:auto}
.champ .cmap{display:block;width:100%;margin:0 auto;height:auto;max-height:560px}
.champ .cm-node{cursor:pointer;transition:opacity .2s var(--ease)}
.champ .cm-box{fill:var(--surface-2)}
.champ .cm-node.anchor .cm-box{fill:var(--gold-soft)}
.champ .cm-node:hover .cm-box,.champ .cm-node.sel .cm-box{fill:var(--gold-soft);filter:drop-shadow(0 3px 8px rgb(0 0 0 / .22))}
.champ .cm-label{font:600 13px var(--font-ui);fill:var(--ink)}
.champ .cm-ref{font:500 11px var(--font-ui);fill:var(--muted)}
.champ .cm-edge{cursor:pointer;transition:opacity .2s var(--ease)}
.champ .cm-hit{stroke:transparent;stroke-width:22}
.champ .cm-line{stroke:var(--gold)}
.champ .cm-edge:hover .cm-line,.champ .cm-edge.sel .cm-line{stroke:var(--gold-strong)}
.champ .cm-pill{fill:var(--bg);stroke:var(--gold-line)}
.champ .cm-edge:hover .cm-pill,.champ .cm-edge.sel .cm-pill{fill:var(--gold-soft);stroke:var(--gold)}
.champ .cm-hook{font:500 18px var(--font-he);fill:var(--ink)}
.champ .dim{opacity:.22}
.champ .cm-node:focus-visible .cm-box,.champ .cm-edge:focus-visible .cm-pill{stroke:var(--focus);stroke-width:3}
.champ .legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px;font:400 var(--fs-xs)/1 var(--font-ui);color:var(--muted);align-items:center}
.champ .legend i{display:inline-block;width:12px;height:12px;border-radius:4px;border:2px solid var(--c);margin-inline-end:6px;vertical-align:-2px}
.champ .legend .ln{display:inline-flex;gap:4px;align-items:center;color:var(--gold-strong)}
.champ .pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:var(--sp-4)}
.champ .pcard{background:var(--surface);border:1px solid var(--line);border-top:3px solid var(--wc);border-radius:var(--r-md);padding:var(--sp-4);box-shadow:var(--sh-1);transition:opacity .2s var(--ease),box-shadow .2s var(--ease);cursor:default}
.champ .pcard.sel{box-shadow:var(--sh-2);border-color:var(--gold)}
.champ .pcard header{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.champ .pill{display:inline-flex;align-items:center;min-height:22px;padding:0 9px;border-radius:var(--r-pill);border:1px solid var(--line-strong);font:500 var(--fs-2xs)/1 var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.champ .pill.role-anchor{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}
.champ .pcard h3{font-family:var(--font-display);font-size:1.3rem;font-weight:600;color:var(--ink);line-height:1.2}
.champ .ref{display:inline-block;font:500 var(--fs-xs)/1.4 var(--font-ui);color:var(--gold-strong);text-decoration:none;margin:2px 0 8px;border-bottom:1px dotted var(--gold-line)}
.champ .ref:hover{border-bottom-style:solid}
.champ .hx,.champ .lx .he{font-family:var(--font-he);font-size:1.45rem;line-height:1.75;margin:4px 0;color:var(--ink);text-align:right}
.champ .tl{margin:2px 0;font-style:italic;color:var(--muted);font-size:.98rem}
.champ .tn{margin:6px 0 0}
.champ mark.hk,.champ mark{background:var(--mark);color:var(--ink);box-shadow:inset 0 -2px 0 var(--gold);border-radius:3px;padding:0 3px}
.champ .lcard{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--sp-5);margin-bottom:var(--sp-4);box-shadow:var(--sh-1);transition:opacity .2s var(--ease),box-shadow .2s var(--ease)}
.champ .lcard.sel{box-shadow:var(--sh-2);border-color:var(--gold)}
.champ .lh{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin-bottom:var(--sp-3)}
.champ .hk-big{font-family:var(--font-he);font-size:2.1rem;line-height:1.2;color:var(--ink)}
.champ .hk-big mark{padding:2px 10px}
.champ .hk-meta{font-size:1rem;color:var(--text)}
.champ .hk-tags{display:flex;gap:10px;align-items:center;margin-inline-start:auto}
.champ .str{font:500 var(--fs-xs)/1 var(--font-ui);color:var(--gold-strong);display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
.champ .str .off{opacity:.25}
.champ .lxs{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4);margin:var(--sp-2) 0 var(--sp-3)}
.champ .lx{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-md);padding:10px 14px}
.champ .nlink{font:500 var(--fs-xs)/1.2 var(--font-ui);color:var(--muted);background:none;border:0;padding:2px 0;cursor:pointer;text-align:start;text-decoration:underline;text-decoration-color:var(--gold-line);text-underline-offset:3px}
.champ .nlink:hover{color:var(--ink)}
.champ .sd{display:grid;grid-template-columns:1fr 1.5fr;gap:var(--sp-5)}
.champ h4{font:600 var(--fs-2xs)/1 var(--font-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--gold-strong);margin-bottom:8px}
.champ .sd p,.champ .shs p{margin:0}
.champ .deep{border-inline-start:2px solid var(--gold-line);padding-inline-start:var(--sp-4)}
.champ .moves{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;padding:0}
.champ .moves li{font:500 var(--fs-xs)/1 var(--font-ui);padding:6px 10px;border-radius:var(--r-pill);background:var(--gold-soft);color:var(--ink)}
.champ .shs{margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px dashed var(--line-strong)}
.champ .sh{display:flex;gap:12px;align-items:flex-start;padding:8px 0}
.champ .sh-play{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid var(--gold-line);background:var(--gold-soft);color:var(--gold-strong);cursor:pointer;font-size:.85rem}
.champ .sh-play:hover{background:var(--gold);color:var(--on-ink)}
.champ .sh-play.off{display:none}
.champ .sh-b{min-width:0}
.champ .sh-t{display:flex;flex-wrap:wrap;gap:2px 12px;font:600 var(--fs-sm)/1.35 var(--font-ui);color:var(--ink);text-decoration:none}
.champ .sh-t:hover .tnum{text-decoration:underline}
.champ .sh-n{font-family:var(--font-he);font-weight:400;color:var(--muted)}
.champ .sh p{font-size:.98rem;color:var(--text)}
.champ .layer{border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);margin-bottom:10px;padding:0 var(--sp-4);transition:opacity .2s var(--ease)}
.champ .layer summary{cursor:pointer;padding:14px 0;font-family:var(--font-display);font-weight:600;font-size:1.2rem;color:var(--ink);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.champ .layer p{margin:0 0 14px}
.champ .syn .synthesis{font-family:var(--font-display);font-size:1.4rem;line-height:1.5;color:var(--ink);margin:0;max-width:var(--w-read);border-inline-start:3px solid var(--gold);padding-inline-start:var(--sp-4)}
.champ .lesson{margin-top:var(--sp-4);padding:var(--sp-4) var(--sp-5);background:var(--ink);color:var(--on-ink);border-radius:var(--r-lg);max-width:var(--w-read)}
.champ .lesson h3{font:600 var(--fs-2xs)/1 var(--font-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:8px}
.champ .lesson p{margin:0;font-size:1.12rem}
.champ .shlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:0 var(--sp-5)}
.champ .quiet ul{margin:0;padding-inline-start:1.2rem;color:var(--muted);font-size:1rem}
.champ .quiet li{margin:6px 0}
.champ .muted{color:var(--muted)}
.champ .ch-foot{display:flex;flex-wrap:wrap;gap:6px 18px;margin:var(--sp-6) 0 var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--line);font:400 var(--fs-xs)/1.4 var(--font-ui);color:var(--muted)}
.champ .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.champ .tnum{font-variant-numeric:tabular-nums}
@media (max-width:760px){.champ .lxs,.champ .sd{grid-template-columns:1fr}.champ .hk-tags{margin-inline-start:0}.champ .deep{padding-inline-start:var(--sp-3)}.champ .lcard{padding:var(--sp-4)}.champ{font-size:1.02rem}}
`;

const TOKENS = `:root{color-scheme:light;--bg:#f5efe0;--bg-deep:#ede4cd;--surface:#fbf8ef;--surface-2:#f8f3e4;--ink:#15223f;--text:#232a3b;--muted:#5c5f6b;--on-ink:#f8f3e4;--gold:#a98532;--gold-strong:#7b5c12;--gold-soft:rgb(169 133 50/.14);--gold-line:rgb(169 133 50/.45);--line:rgb(21 34 63/.13);--line-strong:rgb(21 34 63/.26);--mark:rgb(214 170 60/.38);--focus:#1f4fa3;
--font-he:"Frank Ruhl Libre","Noto Serif Hebrew","David Libre","Times New Roman",serif;--font-display:"Cormorant Garamond","EB Garamond","Iowan Old Style",Georgia,serif;--font-read:"EB Garamond","Iowan Old Style",Georgia,"Times New Roman",serif;--font-ui:Inter,"Source Sans 3",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--fs-2xs:.6875rem;--fs-xs:.78rem;--fs-sm:.875rem;--fs-md:1.125rem;--fs-xl:clamp(1.6rem,1.2rem + 1.4vw,2.1rem);--fs-2xl:clamp(2.1rem,1.5rem + 2.6vw,3.1rem);--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;--r-md:12px;--r-lg:18px;--r-pill:999px;--sh-1:0 1px 2px rgb(21 34 63/.06);--sh-2:0 6px 22px -8px rgb(21 34 63/.22);--w-wide:1120px;--w-read:720px;--ease:cubic-bezier(.2,.7,.2,1)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0e1424;--bg-deep:#0a0f1c;--surface:#151d33;--surface-2:#19223b;--ink:#efe8d6;--text:#e3dfd2;--muted:#a2a8b8;--on-ink:#0e1424;--gold:#cfae62;--gold-strong:#dcbe78;--gold-soft:rgb(207 174 98/.13);--gold-line:rgb(207 174 98/.42);--line:rgb(239 232 214/.12);--line-strong:rgb(239 232 214/.26);--mark:rgb(207 174 98/.35);--focus:#8db4ff;--sh-1:0 1px 2px rgb(0 0 0/.4);--sh-2:0 8px 26px -8px rgb(0 0 0/.6)}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0e1424;--bg-deep:#0a0f1c;--surface:#151d33;--surface-2:#19223b;--ink:#efe8d6;--text:#e3dfd2;--muted:#a2a8b8;--on-ink:#0e1424;--gold:#cfae62;--gold-strong:#dcbe78;--gold-soft:rgb(207 174 98/.13);--gold-line:rgb(207 174 98/.42);--line:rgb(239 232 214/.12);--line-strong:rgb(239 232 214/.26);--mark:rgb(207 174 98/.35);--focus:#8db4ff;--sh-1:0 1px 2px rgb(0 0 0/.4);--sh-2:0 8px 26px -8px rgb(0 0 0/.6)}
body{margin:0;background:var(--bg);color:var(--text)}
.sa-top{display:flex;justify-content:space-between;align-items:center;gap:12px;max-width:var(--w-wide);margin:0 auto;padding:14px 20px 0;font:500 12px var(--font-ui);color:var(--muted)}
.sa-top button{font:inherit;background:none;border:1px solid var(--line-strong);color:var(--ink);border-radius:var(--r-pill);padding:6px 12px;cursor:pointer}
.sa-wrap{padding:0 20px 40px}`;

/** Self-contained HTML file: inline CSS, tokens, inline SVG map, tiny script. Works offline (fonts fall back to system serif). */
export function renderDocument(res: R, o: RenderOpts = {}): string {
  const a = res.data, L = a.answer_language || "es";
  const rtl = L === "he";
  return `<!doctype html>
<html lang="${esc(L)}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)} · Champiñones</title>
<meta name="description" content="${esc(a.summary.slice(0, 180))}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Frank+Ruhl+Libre:wght@400;500;700&family=Inter:wght@400;500;600&display=swap">
<style>${TOKENS}${CHAMP_CSS}</style></head>
<body><div class="sa-top"><span>${esc(tr(L, "standalone"))}</span><button type="button" id="th">${esc(tr(L, "toggleTheme"))}</button></div>
<div class="sa-wrap"><div class="champ standalone" id="champ">${renderBody(res, { ...o, standalone: true })}</div></div>
<script>(function(){var b=document.getElementById("th");b.onclick=function(){var d=document.documentElement,c=d.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.setAttribute("data-theme",c==="dark"?"light":"dark")}})();
(function(){var root=document.getElementById("champ");${INTERACT_JS}})();</script></body></html>`;
}

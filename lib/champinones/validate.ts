import { excerptInSource, bestWindow, hookInText, normRef, isHeStop, heTokens, widenToInclude } from "./text";
import { NONLITERAL_HOOKS, type Analysis, type Link, type Node, type ShiurRef } from "./types";

export type CtxItem = { ref: string; he: string };
export type CtxPassage = { classId: string; startMs: number; endMs: number; champ?: boolean };
export type ValidateCtx = {
  items: CtxItem[];
  passages: CtxPassage[];
  /** Does classId exist and startMs fall inside a transcript segment? (DB lookup, injectable for tests) */
  moment: (classId: string, startMs: number) => boolean;
  classInfo?: (classId: string) => { title: string; ordLabel: string } | null;
  expectedLang?: string;
  /** keep nodes that have no link (whole-set questions must show every member) */
  keepOrphans?: boolean;
};
export type Validation = { data: Analysis; dropped: string[]; flagged: string[]; problems: string[]; invalidRatio: number; repaired: boolean };

const MAX_NODES = 10, MAX_LINKS = 12;

export function validateAnalysis(input: Analysis, ctx: ValidateCtx): Validation {
  const dropped: string[] = [], flagged: string[] = [], problems: string[] = [];
  let repaired = false;
  const a: Analysis = {
    ...input,
    nodes: [...(input.nodes || [])], links: [...(input.links || [])], layers: [...(input.layers || [])],
    shiur_refs: [...(input.shiur_refs || [])], open_questions: [...(input.open_questions || [])], caveats: [...(input.caveats || [])],
  };
  const origCount = Math.max(1, a.nodes.length + a.links.length);
  const items = new Map(ctx.items.map((i) => [normRef(i.ref), i]));
  let bad = 0;

  // ---- nodes
  const nodes: Node[] = [];
  for (const n of a.nodes) {
    const it = items.get(normRef(n.ref));
    if (!it) { dropped.push(`node ${n.id}: ref "${n.ref}" was not in the context`); problems.push(`Node ${n.id} used ref "${n.ref}" which is not in CONTEXT.`); bad++; continue; }
    const flags: string[] = [];
    if (!n.hebrew_excerpt || !excerptInSource(n.hebrew_excerpt, it.he)) {
      const w = bestWindow(n.hebrew_excerpt || "", it.he, Math.min(25, Math.max(8, heTokens(n.hebrew_excerpt || "").length + 3)));
      if (w.score >= 0.6 && w.text) {
        flagged.push(`node ${n.id}: excerpt replaced by the closest verbatim fragment of ${n.ref}`);
        problems.push(`Node ${n.id} (${n.ref}): hebrew_excerpt is not verbatim from CONTEXT.`);
        n.hebrew_excerpt = w.text; flags.push("excerpt_repaired"); repaired = true; bad += 0.5;
      } else { dropped.push(`node ${n.id}: excerpt not found in ${n.ref}`); problems.push(`Node ${n.id} (${n.ref}): hebrew_excerpt not found in the text of that ref.`); bad++; continue; }
    }
    n.ref = it.ref;
    if (flags.length) n.flags = flags;
    nodes.push(n);
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // ---- shiur refs
  const keptShiur: ShiurRef[] = []; const remap = new Map<number, number>();
  (input.shiur_refs || []).forEach((s, i) => {
    const inPassage = ctx.passages.some((p) => p.classId === s.classId && s.startMs >= p.startMs && s.startMs <= p.endMs);
    if (!inPassage || !ctx.moment(s.classId, s.startMs)) { dropped.push(`shiur_ref ${s.classId}@${s.startMs}: not a provided moment`); problems.push(`shiur_refs[${i}] (${s.classId}, ${s.startMs}) is not a classId/startMs from CONTEXT.`); bad += 0.5; return; }
    const dup = keptShiur.findIndex((k) => k.classId === s.classId && k.startMs === s.startMs);
    if (dup >= 0) { remap.set(i, dup); return; }
    const info = ctx.classInfo?.(s.classId);
    const champ = ctx.passages.find((p) => p.classId === s.classId && s.startMs >= p.startMs && s.startMs <= p.endMs)?.champ;
    remap.set(i, keptShiur.length);
    keptShiur.push({ ...s, title: info?.title, ordLabel: info?.ordLabel, champ });
  });

  // ---- links
  const links: Link[] = [];
  for (const l of a.links) {
    const A = nodeById.get(l.from), B = nodeById.get(l.to);
    if (!A || !B || l.from === l.to) { dropped.push(`link ${l.id}: endpoint missing`); bad++; continue; }
    const flags: string[] = [];
    const literal = !NONLITERAL_HOOKS.has(l.hook_type);
    const inA = hookInText(l.hook_text, A.hebrew_excerpt), inB = hookInText(l.hook_text, B.hebrew_excerpt);
    if (literal && !(inA && inB)) {
      const srcA = items.get(normRef(A.ref))!, srcB = items.get(normRef(B.ref))!;
      const fullA = hookInText(l.hook_text, srcA.he), fullB = hookInText(l.hook_text, srcB.he);
      if (!(fullA && fullB)) { dropped.push(`link ${l.id}: hook "${l.hook_text}" not in both texts`); problems.push(`Link ${l.id}: hook_text "${l.hook_text}" is not present in both linked texts.`); bad++; continue; }
      // widen the excerpt(s) lacking the hook so that they include it (bounded), instead of capping strength
      for (const [n, src, has] of [[A, srcA, inA], [B, srcB, inB]] as const) {
        if (has) continue;
        const w = widenToInclude(n.hebrew_excerpt, l.hook_text, src.he, 32);
        if (w) { n.hebrew_excerpt = w; n.flags = [...(n.flags || []), "excerpt_widened"]; repaired = true; }
      }
      if (hookInText(l.hook_text, A.hebrew_excerpt) && hookInText(l.hook_text, B.hebrew_excerpt)) {
        flagged.push(`link ${l.id}: excerpts widened to include the hook`); flags.push("excerpt_widened"); bad += 0.1;
      } else {
        flags.push("hook_outside_excerpt"); flagged.push(`link ${l.id}: hook found in the source texts but not inside the short excerpts`);
        problems.push(`Link ${l.id}: hook_text "${l.hook_text}" must appear inside BOTH hebrew_excerpt fields (extend the excerpts).`); bad += 0.5;
        l.strength = Math.min(l.strength, 2) as 1 | 2 | 3;
      }
    }
    if (!literal && !(inA || inB)) { flags.push("nonliteral_unanchored"); flagged.push(`link ${l.id}: ${l.hook_type} hook without literal anchor`); l.strength = 1; }
    const toks = heTokens(l.hook_text);
    if (l.strength === 3 && (!toks.length || toks.every((t) => t.length < 3 || isHeStop(t)))) { l.strength = 2; flagged.push(`link ${l.id}: strength 3 lowered (common word)`); }
    l.shiur_ref_indexes = [...new Set((l.shiur_ref_indexes || []).map((i) => remap.get(i)).filter((x): x is number => x !== undefined))];
    if (flags.length) l.flags = flags;
    links.push(l);
  }
  links.sort((x, y) => y.strength - x.strength);
  const linksCapped = links.slice(0, MAX_LINKS);

  // ---- orphan nodes
  const linked = new Set(linksCapped.flatMap((l) => [l.from, l.to]));
  const finalNodes = nodes.filter((n) => {
    if (linked.has(n.id) || ctx.keepOrphans) return true;
    dropped.push(`node ${n.id}: not part of any verified link`); return false;
  }).slice(0, MAX_NODES);
  const keep = new Set(finalNodes.map((n) => n.id));
  const finalLinks = linksCapped.filter((l) => keep.has(l.from) && keep.has(l.to));

  // ---- layers / shiur refs actually used (keep all shiur refs that survived; they are verified moments)
  const layers = a.layers.map((y) => ({ ...y, node_ids: (y.node_ids || []).filter((id) => keep.has(id)) }));
  void nodeIds;

  if (ctx.expectedLang && a.answer_language && a.answer_language !== ctx.expectedLang) {
    problems.push(`answer_language is "${a.answer_language}" but must be "${ctx.expectedLang}": rewrite ALL prose fields in that language.`);
    bad += origCount * 0.4;
    flagged.push(`answer_language ${a.answer_language} != ${ctx.expectedLang}`);
  }
  const label = new Map(input.nodes.map((n) => [n.id, n.label]));
  const clean = (t: string) => (t || "").replace(/\b[nN](\d{1,2})\b/g, (m, d) => { const l = label.get("n" + d); return l ? `«${l}»` : m; }).replace(/\b[lL]\d{1,2}\b(?=\s*[):,.])/g, "");
  for (const l of finalLinks) { l.surface_explanation = clean(l.surface_explanation); l.depth_explanation = clean(l.depth_explanation); }
  for (const y of layers) { y.text = clean(y.text); y.title = clean(y.title); }
  for (const s of keptShiur) s.why = clean(s.why);
  a.summary = clean(a.summary); a.synthesis = clean(a.synthesis); if (a.practical_lesson) a.practical_lesson = clean(a.practical_lesson);
  a.open_questions = a.open_questions.map(clean); a.caveats = a.caveats.map(clean);
  const data: Analysis = { ...a, nodes: finalNodes, links: finalLinks, layers, shiur_refs: keptShiur };
  if (!finalLinks.length && !data.caveats.length) data.caveats.push("No hook survived server-side verification against the fetched texts.");
  return { data, dropped, flagged, problems, invalidRatio: bad / origCount, repaired };
}

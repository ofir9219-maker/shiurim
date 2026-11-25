// Minimal stateless MCP server (Streamable HTTP, JSON responses) for the maamarim library.
// Auth = secret token in the URL path (custom connector URL in claude.ai).
import { SERVER_INSTRUCTIONS, UPLOAD_GUIDE } from "./guide";
import { searchMaamarim, syncIndex, quickSearch } from "./search";
import { categoryTree, getMaamar, listCards, upsertMaamar, type UploadInput } from "./store";
import { publicBase, uploadUrl } from "./token";
import type { CategoryNode } from "./types";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const fichaSchema = {
  type: "object",
  description: "Ficha de enriquecimiento para la búsqueda IA (ver guia_biblioteca).",
  properties: {
    summary_es: { type: "string" }, summary_he: { type: "string" }, thesis: { type: "string" },
    keywords: { type: "array", items: { type: "string" } }, concepts: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, label: { type: "string" } }, required: ["label"] } },
    questions: { type: "array", items: { type: "string" } }, rav: { type: "string" }, notes: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, keywords: { type: "array", items: { type: "string" } } } } },
  },
};

export const TOOLS = [
  { name: "guia_biblioteca", description: "Instrucciones completas: formato del texto, categorías y cómo escribir la ficha de enriquecimiento.", inputSchema: { type: "object", properties: {} } },
  { name: "listar_categorias", description: "Árbol de categorías de la biblioteca (código, id, ruta, cantidad de maamarim). Llamar antes de subir.", inputSchema: { type: "object", properties: {} } },
  {
    name: "listar_maamarim", description: "Lista los maamarim de la biblioteca (opcionalmente de una categoría o que coincidan con un texto).",
    inputSchema: { type: "object", properties: { categoria_id: { type: "string" }, texto: { type: "string" } } },
  },
  {
    name: "subir_maamar",
    description: "Sube (o reemplaza, con id) un maamar a la biblioteca. markup = texto completo en el marcado del skill (TITLE:, # פרקים, > citas, {{notas}}); las citas '> @REF|idx|inicio|fin|' se resuelven en Sefaria. Devuelve id, enlace y avisos.",
    inputSchema: {
      type: "object", required: ["markup", "ficha"],
      properties: {
        markup: { type: "string", description: "Texto completo del maamar en el marcado del skill." },
        categoria: { type: "array", items: { type: "string" }, description: "Ruta de categoría en hebreo, ej. [\"גמרא\",\"ברכות\"]." },
        categoria_id: { type: "string", description: "Alternativa: id de una categoría existente." },
        etiquetas: { type: "array", items: { type: "string" } },
        ficha: fichaSchema,
        id: { type: "string", description: "Para reemplazar un maamar ya subido." },
        fecha_iso: { type: "string", description: "yyyy-mm-dd" },
      },
    },
  },
  { name: "obtener_maamar", description: "Devuelve un maamar (texto en marcado, categoría y ficha) para revisarlo o corregirlo.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  {
    name: "buscar_en_maamarim", description: "Búsqueda semántica en la biblioteca: devuelve los pasajes más relevantes (texto completo del פרק) con su enlace.",
    inputSchema: { type: "object", required: ["pregunta"], properties: { pregunta: { type: "string" }, consultas_extra: { type: "array", items: { type: "string" }, description: "Reformulaciones (ej. en hebreo)." }, maamar_id: { type: "string" } } },
  },
];

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const link = (id: string, sec?: string) => `${publicBase()}/maamarim/${id}${sec ? "#" + sec : ""}`;

function treeText(nodes: CategoryNode[], depth = 0): string {
  return nodes.map((n) => `${"  ".repeat(depth)}${n.code}  ${n.name}  (id ${n.id}; ${n.total} maamarim)\n${treeText(n.children, depth + 1)}`).join("");
}

export async function callTool(name: string, args: Record<string, unknown>, token: string) {
  switch (name) {
    case "guia_biblioteca": return text(UPLOAD_GUIDE.replace(/<upload_url>/g, uploadUrl(token)));
    case "listar_categorias": { const t = categoryTree(); return text(t.length ? treeText(t) : "La biblioteca aún no tiene categorías: se crearán con la primera subida."); }
    case "listar_maamarim": {
      let cards = listCards();
      if (typeof args.categoria_id === "string" && args.categoria_id) cards = cards.filter((c) => c.categoryId === args.categoria_id);
      if (typeof args.texto === "string" && args.texto.trim()) { const ids = new Set(await quickSearch(args.texto, 50)); cards = cards.filter((c) => ids.has(c.id)); }
      if (!cards.length) return text("No hay maamarim que coincidan.");
      return text(cards.slice(0, 200).map((c) => `${c.callNumber}  ${c.title}${c.subtitle ? " — " + c.subtitle : ""}  [${c.categoryPath.join(" / ")}]  id=${c.id}  ${link(c.id)}`).join("\n"));
    }
    case "subir_maamar": {
      const input: UploadInput = {
        id: typeof args.id === "string" && args.id ? args.id : undefined,
        markup: typeof args.markup === "string" ? args.markup : "",
        category: Array.isArray(args.categoria) ? (args.categoria as unknown[]).map(String) : typeof args.categoria === "string" ? args.categoria : undefined,
        categoryId: typeof args.categoria_id === "string" ? args.categoria_id : undefined,
        tags: Array.isArray(args.etiquetas) ? (args.etiquetas as unknown[]).map(String) : undefined,
        ficha: (args.ficha && typeof args.ficha === "object" ? args.ficha : undefined) as UploadInput["ficha"],
        dateIso: typeof args.fecha_iso === "string" ? args.fecha_iso : undefined,
      };
      if (input.id && !getMaamar(input.id)) return text(`No existe un maamar con id ${input.id}. Omite "id" para crear uno nuevo.`, true);
      try {
        const r = await upsertMaamar(input);
        const s = await syncIndex().catch(() => null);
        const card = listCards().find((c) => c.id === r.maamar.id);
        return text([
          `${r.created ? "Subido" : "Actualizado"}: «${r.maamar.title}»`,
          `id: ${r.maamar.id}`, `signatura: ${card?.callNumber ?? "?"}  categoría: ${card?.categoryPath.join(" / ") ?? "?"}`,
          `enlace: ${link(r.maamar.id)}`, `capítulos: ${r.maamar.sections.length}, notas: ${r.maamar.notes.length}`,
          s ? `índice de búsqueda: actualizado (${s.embedded} fragmentos con embeddings)` : "índice de búsqueda: se actualizará en la próxima consulta",
          r.warnings.length ? `Avisos:\n- ${r.warnings.join("\n- ")}` : "Sin avisos.",
        ].join("\n"));
      } catch (e) { return text(`No se pudo subir: ${(e as Error).message}`, true); }
    }
    case "obtener_maamar": {
      const m = typeof args.id === "string" ? getMaamar(args.id) : null;
      if (!m) return text("Maamar no encontrado.", true);
      const card = listCards().find((c) => c.id === m.id);
      return text(JSON.stringify({ id: m.id, title: m.title, enlace: link(m.id), signatura: card?.callNumber, categoria: card?.categoryPath, categoria_id: m.categoryId, etiquetas: m.tags, ficha: m.ficha, markup: m.markup }, null, 1));
    }
    case "buscar_en_maamarim": {
      const q = typeof args.pregunta === "string" ? args.pregunta : "";
      if (!q.trim()) return text("Falta la pregunta.", true);
      const extra = Array.isArray(args.consultas_extra) ? (args.consultas_extra as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const ps = await searchMaamarim([q, ...extra], { k: 8, maamarId: typeof args.maamar_id === "string" ? args.maamar_id : undefined, budget: 3500 });
      if (!ps.length) return text("No se encontraron pasajes relevantes en la biblioteca.");
      return text(ps.map((p, i) => `[${i + 1}] «${p.title}» (${p.callNumber}) — ${p.sectionTitle}\n${link(p.maamarId, p.sectionId)}\n${p.text}`).join("\n\n---\n\n"));
    }
    default: return null;
  }
}

/** Handle one JSON-RPC message. Returns null for notifications. */
export async function handleRpc(msg: Rpc, token: string): Promise<Record<string, unknown> | null> {
  const isNotif = msg.id === undefined || msg.id === null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(-32600, "Invalid Request");
  if (isNotif) return null;
  switch (msg.method) {
    case "initialize": {
      const want = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "biblioteca-maamarim", title: "Biblioteca de Maamarim", version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Record<string, unknown>;
      try {
        const r = await callTool(name, args, token);
        return r ? ok(r) : err(-32602, `Herramienta desconocida: ${name}`);
      } catch (e) { return ok(text(`Error: ${(e as Error).message}`, true)); }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${msg.method}`);
  }
}

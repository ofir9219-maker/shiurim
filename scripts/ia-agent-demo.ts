// End-to-end demo of the AI work zone: a real model acts as the AI agent, given ONLY the zone URL.
//   OPENAI_API_KEY=... tsx scripts/ia-agent-demo.ts <zone-url> [--model gpt-5-mini] [--max-jobs 5] [--tries 4]
// Flow: read llms.txt -> list pending -> claim -> (job JSON + llms.txt as instructions) -> OpenAI -> POST result -> on {ok:false} feed the errors back and retry.
import { setupProxy } from "../lib/proxy";
setupProxy(); // honours HTTPS_PROXY when present (no-op otherwise)
const args = process.argv.slice(2);
const zone = (args.find((a) => /^https?:\/\//.test(a)) || process.env.AI_ZONE_URL || "").replace(/\/$/, "");
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const INJECT = args.includes("--inject-error"); // corrupt the first submission of each job to exercise the validation-error loop
const MODEL = opt("model", process.env.DEMO_MODEL || "gpt-5-mini"), MAX_JOBS = Number(opt("max-jobs", "5")), TRIES = Number(opt("tries", "4"));
if (!zone) { console.error("Uso: tsx scripts/ia-agent-demo.ts <https://…/ia/<token>>"); process.exit(2); }
const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
type Msg = { role: "system" | "user" | "assistant"; content: string };

async function llm(messages: Msg[]): Promise<{ text: string; usage: { in: number; out: number } }> {
  const body: Record<string, unknown> = { model: MODEL, messages, response_format: { type: "json_object" } };
  if (/^(gpt-5|o\d)/.test(MODEL)) { body.reasoning_effort = process.env.DEMO_EFFORT || "low"; body.max_completion_tokens = 40000; } else body.temperature = 0.2;
  for (let k = 0; ; k++) {
    const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify(body) });
    if (!r.ok) { if (k < 3 && r.status >= 429) { await new Promise((s) => setTimeout(s, 2000 * (k + 1))); continue; } throw new Error(`OpenAI HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); }
    const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    return { text: j.choices[0].message.content, usage: { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 } };
  }
}
const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, init); const t = await r.text(); let body: any; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; };

// 1) the agent only knows the zone URL: read its instructions
const txt = await fetch(`${zone}/llms.txt`);
if (!txt.ok) { console.error(`llms.txt -> HTTP ${txt.status}`); process.exit(1); }
const instructions = await txt.text();
const api = zone.replace("/ia/", "/api/ia/");
log(`llms.txt leído (${instructions.length} caracteres); API base ${api.replace(/\/[^/]+$/, "/<token>")}`);

let corrected = 0, rejectedTotal = 0, tokensIn = 0, tokensOut = 0;
for (let n = 0; n < MAX_JOBS; n++) {
  // 2) list -> claim
  const list = await j(`${api}/jobs?status=pending`);
  if (!Array.isArray(list.body) || !list.body.length) { log("no quedan jobs pendientes: fin"); break; }
  const pick = list.body[0];
  const claim = await j(`${api}/jobs/${pick.job_id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holder: `demo-${MODEL}` }) });
  if (claim.status !== 200) { log(`claim ${pick.job_id} -> ${claim.status}; siguiente`); continue; }
  const job = claim.body; log(`job ${job.job_id} tomado (parte ${job.part}/${job.parts}, ${job.segments.length} segmentos) hasta ${job.claimed_until}`);
  // 3) correct with the model, following only what the zone page says
  const system = `Eres una IA agente. Esta es la página de instrucciones de la Zona IA que debes seguir al pie de la letra:\n\n${instructions}\n\nTu salida debe ser ÚNICAMENTE el objeto JSON del resultado (esquema «Resultado»), sin texto adicional.`;
  const { job_id, status, lease_id, claimed_until, renewed, last_errors, ...jobData } = job; void status; void lease_id; void claimed_until; void renewed; void last_errors;
  const msgs: Msg[] = [{ role: "system", content: system }, { role: "user", content: `Corrige este job y devuelve el resultado.\n\n${JSON.stringify({ job_id, ...jobData })}` }];
  let ok = false;
  for (let t = 1; t <= TRIES && !ok; t++) {
    const out = await llm(msgs); tokensIn += out.usage.in; tokensOut += out.usage.out;
    if (INJECT && t === 1) { const o = JSON.parse(out.text); o.segments[1].startMs += 5; o.segments[3].text = ""; out.text = JSON.stringify(o); log("(inyectando 2 errores en el primer envío)"); }
    // 4) submit; on {ok:false} the errors go back to the model
    const res = await j(`${api}/jobs/${job.job_id}/result?lease_id=${job.lease_id}`, { method: "POST", headers: { "content-type": "application/json" }, body: out.text });
    if (res.body?.ok) { ok = true; log(`intento ${t}: ok=true applied=${res.body.applied} — ${res.body.message}`); }
    else {
      rejectedTotal++; log(`intento ${t}: ok=false (${res.status}) — ${(res.body?.errors ?? []).length} error(es): ${JSON.stringify((res.body?.errors ?? []).slice(0, 4))}`);
      msgs.push({ role: "assistant", content: out.text }, { role: "user", content: `El servidor rechazó el resultado:\n${JSON.stringify(res.body)}\nCorrige exactamente esos problemas y devuelve el JSON completo de nuevo.` });
    }
  }
  if (ok) corrected++; else { log(`job ${job.job_id} no se pudo completar; release`); await j(`${api}/jobs/${job.job_id}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
}
const fin = await j(`${api}/jobs?status=all`);
log(`RESUMEN: ${corrected} job(s) aceptados, ${rejectedTotal} envío(s) rechazados en el camino, modelo ${MODEL}, tokens ${tokensIn}/${tokensOut}; cola final: ${JSON.stringify(Array.isArray(fin.body) ? fin.body.map((x: any) => `${x.job_id}:${x.status}`) : fin.body)}`);
process.exit(corrected > 0 ? 0 : 1);

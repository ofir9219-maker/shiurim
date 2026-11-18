// Handlers of /api/ia/<token>/* (the token is the auth). Pure functions over the zone store, called by the route files and by tests.
import { gate, json, readBody, optionsResponse, originOf } from "./http";
import * as Z from "./jobs";

type P = { token: string; jobId?: string };
export const apiBase = (req: Request, token: string) => `${originOf(req)}/api/ia/${token}`;
export const OPTIONS = optionsResponse;

const missing = () => json({ ok: false, error: "Job no encontrado." }, 404);
const errorsOut = (e: Z.Problem[]) => e.map((x) => ({ where: x.where, problem: x.problem }));

async function jobOut(j: Z.Job, extra: Record<string, unknown> = {}) {
  const data = await Z.getJobData(j);
  const st = Z.statusOf(j);
  return { ...data, status: st, ...(st === "claimed" ? { claimed_until: j.lease!.until } : {}), ...(j.errors?.length && st !== "done" ? { last_errors: errorsOut(j.errors) } : {}), ...extra };
}
const find = (id: string) => { const j = Z.getJob(id); return j && Z.isListed(j) && j.status !== "discarded" ? j : null; };

export function list(req: Request, p: P) {
  const g = gate(req, p.token); if (g) return g;
  const status = new URL(req.url).searchParams.get("status") || "pending";
  if (!["pending", "claimed", "done", "failed", "all"].includes(status)) return json({ ok: false, error: "status debe ser pending | claimed | done | failed | all" }, 400);
  return json(Z.listSummaries(status).map(({ status: s, ...r }) => ({ ...r, status: s })));
}
export async function get(req: Request, p: P) {
  const g = gate(req, p.token); if (g) return g;
  const j = find(p.jobId!); if (!j) return missing();
  try { return json(await jobOut(j)); } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
}
export async function claim(req: Request, p: P) {
  const g = gate(req, p.token); if (g) return g;
  const body = (await req.json().catch(() => ({}))) as { lease_id?: string; holder?: string };
  let id = p.jobId!;
  if (id === "next") { const n = Z.listSummaries("pending").find((s) => s.status === "pending") ?? Z.listSummaries("pending")[0]; if (!n) return json({ ok: false, error: "No quedan jobs pendientes." }, 404); id = n.job_id; }
  const r = Z.claim(id, { leaseId: body.lease_id, holder: body.holder });
  if (!r.ok) return json({ ok: false, error: r.error, ...(r.claimed_until ? { claimed_until: r.claimed_until } : {}) }, r.code);
  try { return json(await jobOut(r.job, { lease_id: r.lease.id, claimed_until: r.lease.until, renewed: r.renewed })); } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
}
export async function result(req: Request, p: P) {
  const g = gate(req, p.token); if (g) return g;
  const j = find(p.jobId!); if (!j) return missing();
  const b = await readBody(req, Z.MAX_BODY); if ("error" in b) return b.error;
  const lease = new URL(req.url).searchParams.get("lease_id") || req.headers.get("x-lease-id") || undefined;
  if (lease && Z.leaseActive(j) && j.lease!.id !== lease) return json({ ok: false, error: "El lease de este job pertenece a otro agente." }, 409);
  const r = await Z.receiveResult(j, b.text, "api");
  return json({ ok: r.ok, applied: r.applied, message: r.message, errors: errorsOut(r.errors), waiting_for_parts: r.waitingForParts ?? [], ...(r.ok ? {} : { next: "Corrige exactamente lo que dicen los errores y vuelve a hacer POST a esta misma URL." }) }, r.ok ? 200 : 422);
}
export async function release(req: Request, p: P) {
  const g = gate(req, p.token); if (g) return g;
  const body = (await req.json().catch(() => ({}))) as { lease_id?: string };
  const r = Z.release(p.jobId!, { leaseId: body.lease_id });
  return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error }, r.code);
}

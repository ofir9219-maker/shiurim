import { setupProxy } from "../proxy";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
/** fetch with retries on network errors, 429 and 5xx (exponential backoff). Returns the Response (ok or non-retryable error not thrown). */
export async function fetchRetry(url: string, init: RequestInit = {}, opts: { tries?: number; baseMs?: number } = {}): Promise<Response> {
  setupProxy();
  const tries = opts.tries ?? 5, base = opts.baseMs ?? 1000;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status === 429 || r.status >= 500) { last = new HttpError(r.status, `HTTP ${r.status} ${url.split("?")[0]}: ${(await r.text()).slice(0, 300)}`); }
      else return r;
    } catch (e) { last = e; }
    await sleep(base * 2 ** i);
  }
  throw last;
}
export async function okJson<T>(r: Response, what: string): Promise<T> {
  if (!r.ok) throw new HttpError(r.status, `${what}: HTTP ${r.status} ${(await r.text()).slice(0, 400)}`);
  return (await r.json()) as T;
}

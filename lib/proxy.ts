import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let done = false;
/** Route Node's global fetch through HTTPS_PROXY / HTTP_PROXY when set (Node does not do it itself). */
export function setupProxy() {
  if (done) return;
  done = true;
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

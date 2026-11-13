// Client-side secrets (app token, OpenRouter key) live only on this device and travel as headers.
const LS = "macrosnap.client.v1";
export const local = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
export function saveLocal(patch) {
  Object.assign(local, patch);
  try { localStorage.setItem(LS, JSON.stringify(local)); } catch {}
}

export async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (local.token) headers.authorization = `Bearer ${local.token}`;
  if (local.orKey) headers["x-openrouter-key"] = local.orKey;
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

export const get = (p) => api("GET", p);
export const post = (p, b) => api("POST", p, b ?? {});
export const put = (p, b) => api("PUT", p, b ?? {});
export const del = (p) => api("DELETE", p);

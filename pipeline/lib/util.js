import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCHEMA_VERSION = "0.3.0";

export const rel = (...p) => path.join(ROOT, ...p);
export const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
export const readJsonIf = p => (fs.existsSync(p) ? readJson(p) : null);
export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, p);
}

export const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, n = 0) => Math.round(v * 10 ** n) / 10 ** n;
export const minutesBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
export const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** GET com timeout e novas tentativas em falha de rede ou 5xx. */
export async function http(url, { headers = {}, timeoutMs = 20000, retries = 2, method = "GET", body } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return res;
    } catch (e) {
      last = e;
      if (e.fatal) break;
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw last;
}
export const httpJson = async (url, opts) => (await http(url, opts)).json();

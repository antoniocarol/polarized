// Cotações diárias (Stooq, CSV sem chave): índices de bolsa, câmbio e commodities.
import { http, iso, round, readJson, rel, SCHEMA_VERSION } from "../lib/util.js";
import { country, placeOf, point } from "../lib/geo.js";

const M = readJson(rel("pipeline/data/markets.json"));
const KEEP = 30;

export function parseDaily(csv) {
  const rows = [];
  for (const line of String(csv).trim().split(/\r?\n/).slice(1)) {
    const [d, , , , close] = line.split(",");
    const c = Number(close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(c)) rows.push({ d, close: c });
  }
  return rows.sort((a, b) => a.d.localeCompare(b.d));
}

export default {
  id: "stooq",
  fixture: "stooq.json",
  async fetch(ctx) {
    const raw = {}, warnings = [];
    for (const i of M.instruments) {
      try {
        const text = await (await http(`${ctx.source.endpoint}?s=${encodeURIComponent(i.symbol)}&i=d`, { timeoutMs: 20000, retries: 1 })).text();
        if (!/^Date,/i.test(text)) throw new Error("resposta sem dados");
        raw[i.symbol] = text;
      } catch (e) { warnings.push(`${i.symbol}: ${e.message}`); }
    }
    return { raw, warnings };
  },
  normalize(res, ctx) {
    const out = [];
    for (const i of M.instruments) {
      const rows = parseDaily((res.raw || res)[i.symbol] || "").slice(-(KEEP + 1));
      if (rows.length < 3) continue;
      const points = rows.slice(1).map((r, k) => ({ d: r.d, close: round(r.close, 4), changePct: round(((r.close - rows[k].close) / rows[k].close) * 100, 2) }));
      const c = i.iso2 ? country(i.iso2) : null;
      out.push({
        id: `stooq:ser:${i.symbol}`, schemaVersion: SCHEMA_VERSION, kind: "series", layer: "economia", subtype: i.subtype,
        instrument: { symbol: i.symbol, name: i.name, exchange: i.exchange, currency: i.currency, unit: i.unit || null, note: null },
        place: c ? placeOf(c) : null, geo: i.city ? point(i.city[0], i.city[1]) : null,
        points, last: points.at(-1), status: "nao_verificado", confidence: 0.85,
        sources: [{ sourceId: "stooq", url: `https://stooq.com/q/?s=${encodeURIComponent(i.symbol)}`, retrievedAt: iso(ctx.now) }],
        updatedAt: iso(ctx.now),
      });
    }
    return { entities: out, warnings: res.warnings || [] };
  },
};

// IODA (Georgia Tech) — quedas de conectividade por país.
// O formato de resposta é lido de forma tolerante: aceita {data: [...]} ou [...] com
// location "country/XX", start (unix s) e duration (s). Confira contra a API antes de ativar.
import { httpJson, clamp } from "../lib/util.js";
import { country, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const hours = s => (s >= 7200 ? `${Math.round(s / 3600)} h` : `${Math.max(1, Math.round(s / 60))} min`);

export default {
  id: "ioda",
  fixture: "ioda.json",
  async fetch(ctx) {
    const until = Math.floor(Date.parse(ctx.now) / 1000);
    const from = until - ctx.policy.events.outageWindowHours * 3600;
    return httpJson(`${ctx.source.endpoint}?from=${from}&until=${until}&entityType=country`, { timeoutMs: 45000 });
  },
  normalize(raw, ctx) {
    const list = Array.isArray(raw) ? raw : raw.data || [];
    const out = [];
    for (const o of list) {
      const code = String(o.location || o.entity?.code || "").split("/").pop().toUpperCase();
      const c = country(code);
      if (!c || !o.start) continue;
      const startMs = o.start * 1000, dur = o.duration || 0;
      const ongoing = startMs + dur * 1000 >= Date.parse(ctx.now) - 5 * 60000;
      const score = Number(o.score) || 0;
      out.push(entity({
        id: `ioda:evt:${c.iso2}-${o.start}`, kind: "event", layer: "ciber", subtype: "queda_internet",
        geo: point(c.lat, c.lon), place: placeOf(c),
        start: startMs, end: ongoing ? null : startMs + dur * 1000, observedAt: ctx.now, precision: "minute",
        intensity: clamp(Math.round(Math.log10(Math.max(score, 1)) - 1), 1, 5), basis: "log10 do score de queda do IODA, menos 1",
        status: "nao_verificado", confidence: 0.7,
        sourceId: "ioda", ref: `${c.iso2}-${o.start}`, url: `https://ioda.inetintel.cc.gatech.edu/country/${c.iso2}`, retrievedAt: ctx.now,
        headline: `Queda de internet detectada — ${c.pt}`,
        summary: `Sinais de conectividade abaixo do normal ${ongoing ? "há" : "por"} ${hours(dur)}. ` +
          "Detecção automática; a fonte não diz a causa (apagão, corte deliberado ou falha técnica).",
        clusterKey: `queda:${c.iso2}:${Math.floor(o.start / 3600)}`,
        links: [{ label: `Painel IODA — ${c.pt}`, url: `https://ioda.inetintel.cc.gatech.edu/country/${c.iso2}` }],
      }));
    }
    return out;
  },
};

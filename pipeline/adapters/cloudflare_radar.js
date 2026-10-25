// Cloudflare Radar — quedas de internet anotadas por analistas, com causa e alcance.
// Exige token (CLOUDFLARE_API_TOKEN). Licença CC BY-NC: confira o uso num projeto com anúncios.
import { httpJson } from "../lib/util.js";
import { country, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const CAUSE = { GOVERNMENT_DIRECTED: "ordem do governo", POWER_OUTAGE: "falta de energia", CABLE_CUT: "cabo rompido", WEATHER: "clima",
  TECHNICAL_PROBLEM: "problema técnico", MILITARY_ACTION: "ação militar", MAINTENANCE: "manutenção", CYBERATTACK: "ataque cibernético",
  FIRE: "incêndio", EARTHQUAKE: "terremoto", UNKNOWN: "não informada" };
const SCOPE = { NATIONWIDE: ["em todo o país", 4], REGIONAL: ["regional", 3], NETWORK: ["em uma rede", 2] };

export default {
  id: "cloudflare_radar",
  fixture: "cloudflare_radar.json",
  needs: ["CLOUDFLARE_API_TOKEN"],
  async fetch(ctx) {
    return httpJson(`${ctx.source.endpoint}?dateRange=1d&format=json&limit=100`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
  },
  normalize(raw, ctx) {
    const out = [];
    for (const a of raw.result?.annotations || []) {
      const cause = a.outage?.outageCause || "UNKNOWN", [scope, base] = SCOPE[a.outage?.outageType] || ["", 2];
      for (const code of a.locations || []) {
        const c = country(code);
        if (!c) continue;
        const political = cause === "GOVERNMENT_DIRECTED" || cause === "MILITARY_ACTION";
        out.push(entity({
          id: `cloudflare_radar:evt:${a.id}-${c.iso2}`, kind: "event", layer: "ciber",
          subtype: cause === "CYBERATTACK" ? "incidente" : "queda_internet",
          geo: point(c.lat, c.lon), place: placeOf(c),
          start: a.startDate, end: a.endDate || null, observedAt: ctx.now, precision: "minute",
          intensity: Math.min(5, base + (political ? 1 : 0)), basis: "alcance (país 4, região 3, rede 2), +1 se a causa for ordem do governo ou ação militar",
          status: "verificado", confidence: 0.85,
          sourceId: "cloudflare_radar", ref: String(a.id), url: `https://radar.cloudflare.com/${c.iso2.toLowerCase()}`, retrievedAt: ctx.now,
          headline: `Queda de internet ${scope} — ${c.pt}`.replace("  ", " "),
          summary: `Causa segundo o Cloudflare Radar: ${CAUSE[cause] || cause.toLowerCase()}.${a.endDate ? "" : " A queda continuava no momento da coleta."}`,
          body: a.description ? `Nota original (inglês): ${a.description}` : undefined,
          tags: [`causa-${cause.toLowerCase()}`],
          clusterKey: `queda:${c.iso2}:${String(a.startDate).slice(0, 10)}`,
        }));
      }
    }
    return out;
  },
};

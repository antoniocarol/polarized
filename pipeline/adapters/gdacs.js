// GDACS — alertas de desastres da ONU e da Comissão Europeia.
// O endpoint e o formato vêm da API pública do GDACS; o adaptador aceita qualquer
// FeatureCollection com as propriedades abaixo e ignora o que não reconhece.
import { httpJson } from "../lib/util.js";
import { country, countryAt, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const TYPES = {
  FL: { layer: "clima", subtype: "enchente", label: "Enchente" },
  TC: { layer: "clima", subtype: "tempestade", label: "Ciclone tropical" },
  DR: { layer: "clima", subtype: "seca", label: "Seca" },
  WF: { layer: "clima", subtype: "incendio", label: "Incêndio florestal" },
  VO: { layer: "sismico", subtype: "vulcao", label: "Erupção vulcânica" },
};
const LEVEL = { green: 2, orange: 3, red: 5 };
const LEVEL_PT = { green: "verde", orange: "laranja", red: "vermelho" };

export default {
  id: "gdacs",
  fixture: "gdacs.json",
  async fetch(ctx) { return httpJson(ctx.source.endpoint, { headers: { accept: "application/json" } }); },
  normalize(raw, ctx) {
    const out = [];
    const seen = new Set();
    for (const f of raw.features || []) {
      const p = f.properties || {};
      const t = TYPES[p.eventtype];
      if (!t || f.geometry?.type !== "Point") continue;   // EQ fica com o USGS
      const level = String(p.alertlevel || "").toLowerCase();
      const recent = Date.parse(ctx.now) - Date.parse(p.fromdate) < 3 * 864e5;
      if (level === "green" && !recent) continue;
      const key = `${p.eventtype}-${p.eventid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [lon, lat] = f.geometry.coordinates;
      const c = country(p.iso3) || countryAt(lat, lon);
      const current = String(p.iscurrent).toLowerCase() === "true";
      const sev = p.severitydata?.severitytext;
      out.push(entity({
        id: `gdacs:evt:${key}`, kind: "event", layer: t.layer, subtype: t.subtype,
        geo: point(lat, lon), place: placeOf(c, c ? null : p.country || null),
        start: p.fromdate, end: current ? null : p.todate, observedAt: p.datemodified || p.fromdate, precision: "day",
        intensity: LEVEL[level] ?? 1, basis: "nível de alerta GDACS: verde 2, laranja 3, vermelho 5",
        status: "nao_verificado", confidence: 0.75,
        sourceId: "gdacs", ref: key, url: p.url?.report, retrievedAt: ctx.now,
        headline: `${t.label}${p.name ? ` — ${p.name}` : ""}${c ? `, ${c.pt}` : ""}`.slice(0, 140),
        summary: [`Alerta ${LEVEL_PT[level] || level} do GDACS.`, sev ? `Severidade estimada: ${sev}.` : null,
          "Estimativa automática por modelo; números de afetados vêm depois das agências em campo."].filter(Boolean).join(" "),
        links: p.url?.report ? [{ label: "Relatório GDACS", url: p.url.report }] : [],
        clusterKey: `${t.subtype}:${c?.iso2 || "mar"}:${p.eventid}`,
      }));
    }
    return out;
  },
};

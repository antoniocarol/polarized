// UCDP — eventos de violência organizada georreferenciados (GED, versão "candidata", mensal).
// Doc: https://ucdp.uu.se/apidocs/ — a API pede token no cabeçalho x-ucdp-access-token.
// Gera eventos (os mais graves por país) e uma condição de conflito por país.
import { httpJson, iso } from "../lib/util.js";
import { countryAt, countryByName, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";
import { capPerCountry, countryCondition, deathScale } from "../lib/aggregate.js";

const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const VIOLENCE = { 1: "confronto entre um Estado e outro grupo armado", 2: "confronto entre grupos armados não estatais", 3: "violência contra civis" };

export default {
  id: "ucdp",
  fixture: "ucdp.json",
  async fetch(ctx) {
    const days = ctx.policy.events.ucdpWindowDays, to = Date.parse(ctx.now);
    const headers = process.env.UCDP_TOKEN ? { "x-ucdp-access-token": process.env.UCDP_TOKEN } : {};
    const base = process.env.UCDP_ENDPOINT || ctx.source.endpoint;
    let url = `${base}?pagesize=1000&StartDate=${ymd(to - days * 864e5)}&EndDate=${ymd(to)}`;
    const rows = [];
    for (let page = 0; url && page < 10; page++) {
      const r = await httpJson(url, { headers, timeoutMs: 60000 });
      rows.push(...(r.Result || []));
      url = r.NextPageUrl || null;
    }
    return { Result: rows };
  },
  normalize(raw, ctx) {
    const P = ctx.policy.events, now = ctx.now;
    const events = [], byCountry = new Map();
    for (const r of raw.Result || []) {
      if (r.latitude == null || r.longitude == null) continue;
      const c = countryByName(r.country) || countryAt(r.latitude, r.longitude);
      if (!c) continue;
      const best = Number(r.best) || 0, lo = Number(r.low) || 0, hi = Number(r.high) || best;
      const interstate = /^Government of/.test(r.side_a || "") && /^Government of/.test(r.side_b || "");
      const condId = `ucdp:cond:${c.iso2.toLowerCase()}-conflito`;
      events.push(entity({
        id: `ucdp:evt:${r.id}`, kind: "event", layer: "conflito",
        subtype: Number(r.type_of_violence) === 3 ? "violencia_armada" : "confronto_armado",
        geo: point(r.latitude, r.longitude), place: placeOf(c, r.adm_1 || null),
        start: r.date_start, end: r.date_end && r.date_end !== r.date_start ? r.date_end : null, observedAt: r.date_end || r.date_start, precision: "day",
        intensity: deathScale(best), basis: "mortes estimadas (best): 1 a 9 → 2, 10 a 99 → 3, 100 a 999 → 4, mil ou mais → 5",
        status: "corroborado", confidence: 0.75,
        sourceId: "ucdp", ref: String(r.id), url: "https://ucdp.uu.se/", retrievedAt: now,
        headline: `${interstate ? "Combate entre países" : "Confronto armado"} — ${r.where_description || r.adm_1 || c.pt}`.slice(0, 140),
        summary: `${VIOLENCE[r.type_of_violence] || "violência organizada"}: ${r.dyad_name}. ${best} mortes estimadas (faixa ${lo} a ${hi}). Dado preliminar do UCDP.`,
        parentId: condId,
      }));
      const agg = byCountry.get(c.iso2) || { n: 0, best: 0, lo: 0, hi: 0, type1: false, interstate: false, first: r.date_start };
      agg.n++; agg.best += best; agg.lo += lo; agg.hi += hi;
      agg.type1 ||= Number(r.type_of_violence) === 1; agg.interstate ||= interstate;
      if (r.date_start < agg.first) agg.first = r.date_start;
      byCountry.set(c.iso2, agg);
    }
    const conditions = [];
    for (const [iso2, a] of byCountry) {
      if (a.n < 3 && a.best < 10) continue;
      const monthly = a.best / (P.ucdpWindowDays / 30);
      const subtype = a.interstate ? "guerra_interestatal" : a.type1 ? (monthly >= 80 ? "guerra_civil" : "insurgencia") : "violencia_armada";
      const label = { guerra_interestatal: "Guerra entre países", guerra_civil: "Guerra civil", insurgencia: "Insurgência armada", violencia_armada: "Violência armada" }[subtype];
      conditions.push(...countryCondition({
        sourceId: "ucdp", iso2, layer: "conflito", subtype, id: `ucdp:cond:${iso2.toLowerCase()}-conflito`, start: a.first, now,
        intensity: deathScale(a.best), basis: `soma das mortes estimadas nos últimos ${P.ucdpWindowDays} dias; tipo pela regra: dois governos = entre países, mais de 80 mortes/mês num conflito com o Estado = guerra civil`,
        status: "corroborado", confidence: 0.8,
        headline: c => `${label} — ${c.pt}`,
        summary: c => `${a.n} eventos de violência organizada e cerca de ${a.best} mortes registrados em ${c.pt} nos últimos ${P.ucdpWindowDays} dias. Dados preliminares do UCDP.`,
        url: "https://ucdp.uu.se/", clusterKey: `conflito:${iso2}`,
        metric: `mortes_${P.ucdpWindowDays}d`, unit: "pessoas", value: a.best, method: `UCDP, soma da estimativa central (faixa ${a.lo} a ${a.hi})`,
      }));
    }
    const ids = new Set(conditions.map(e => e.id));
    for (const e of events) if (!ids.has(e.parentId)) delete e.parentId;
    return { entities: [...conditions, ...capPerCountry(events, P.maxEventsPerCountry)] };
  },
};

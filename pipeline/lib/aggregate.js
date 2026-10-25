import { iso } from "./util.js";
import { country, placeOf, point } from "./geo.js";
import { entity } from "./entity.js";
import { SCHEMA_VERSION } from "./util.js";

/** Escala de mortes para intensidade 1–5, usada por UCDP e ACLED. */
export const deathScale = n => (n >= 1000 ? 5 : n >= 100 ? 4 : n >= 10 ? 3 : n >= 1 ? 2 : 1);

/** Mantém os N eventos mais graves (e, no empate, mais recentes) de cada país. */
export function capPerCountry(events, n) {
  const by = new Map();
  for (const e of events) { const k = e.place.iso2 || "??"; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return [...by.values()].flatMap(list => list
    .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0) || b.time.start.localeCompare(a.time.start)).slice(0, n));
}

/** Condição por país a partir de contagens, com uma medida de uma fonte só. */
export function countryCondition({ sourceId, iso2, layer, subtype, id, start, now, intensity, basis, status, confidence, headline, summary, url, clusterKey, metric, unit, value, method, startKnown }) {
  const c = country(iso2);
  if (!c) return [];
  const e = entity({
    id, kind: "condition", layer, subtype, geo: point(c.lat, c.lon), place: placeOf(c),
    start, observedAt: now, precision: "day", intensity, basis, status, confidence,
    sourceId, ref: iso2, url, retrievedAt: now, headline: headline(c), summary: summary(c), clusterKey,
  });
  if (startKnown === false) e.time.startKnown = false;
  const out = [e];
  if (metric) out.push({
    id: `plz:measure:${id.split(":").pop()}-${metric}`.replace(/[^A-Za-z0-9:._-]/g, "-").toLowerCase(), schemaVersion: SCHEMA_VERSION, kind: "measure",
    subject: { type: "condition", id }, metric, unit, periodStart: iso(start), periodEnd: iso(now),
    assertions: [{ sourceId, value, observedAt: iso(now), ...(method ? { method } : {}) }],
    spread: { low: value, high: value, relative: 0 }, disputed: false, consensus: null, updatedAt: iso(now),
  });
  return out;
}

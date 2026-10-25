// USGS Earthquake Hazards — GeoJSON público, sem chave.
// Formato: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
import { httpJson, clamp, round } from "../lib/util.js";
import { countryAt, countryByName, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const DIR = { N: "N", S: "S", E: "L", W: "O" };
const SCALE = { mww: "Mww", mwr: "Mwr", mwc: "Mw", mwb: "Mw", mw: "Mw", mb: "mb", ml: "ML", md: "Md", ms: "Ms" };
const ALERT = { green: "verde", yellow: "amarelo", orange: "laranja", red: "vermelho" };

/** "12 km SSW of Tobelo, Indonesia" -> "12 km a SSO de Tobelo, Indonésia" */
export function placePt(s, c) {
  const m = /^(\d+) km ([NSEW]{1,3}) of (.+?)(?:, ([^,]+))?$/.exec(s || "");
  if (!m) return s || "local não informado";
  const tail = m[4] ? `, ${c?.pt || m[4]}` : "";
  return `${m[1]} km a ${m[2].replace(/[NSEW]/g, d => DIR[d])} de ${m[3]}${tail}`;
}

export default {
  id: "usgs",
  fixture: "usgs.json",
  async fetch(ctx) { return httpJson(ctx.source.endpoint); },
  normalize(raw, ctx) {
    const minMag = ctx.policy.events.minQuakeMagnitude;
    const out = [];
    for (const f of raw.features || []) {
      const p = f.properties || {};
      if (p.type !== "earthquake" || typeof p.mag !== "number") continue;
      if (p.mag < minMag && !p.alert) continue;
      const [lon, lat, depth] = f.geometry.coordinates;
      const tail = (p.place || "").split(",").pop().trim();
      const c = countryAt(lat, lon) || countryByName(tail);
      const label = placePt(p.place, c);
      const bump = { orange: 1, red: 2 }[p.alert] || 0;
      const intensity = clamp(Math.round((p.mag - 4) * 1.25) + bump, 0, 5);
      const reviewed = p.status === "reviewed";
      const summary = [
        `Profundidade de ${round(depth, 1)} km.`,
        p.alert ? `Alerta PAGER ${ALERT[p.alert] || p.alert} para impacto estimado.` : null,
        p.tsunami ? "Evento grande em região oceânica: acompanhe os centros oficiais de alerta de tsunami." : null,
        reviewed ? "Revisado por sismólogo." : "Solução automática, ainda sem revisão humana.",
      ].filter(Boolean).join(" ");
      out.push(entity({
        id: `usgs:evt:${f.id}`, kind: "event", layer: "sismico", subtype: "terremoto",
        geo: point(lat, lon), place: placeOf(c, c ? null : label),
        start: p.time, observedAt: p.updated || p.time, precision: "minute",
        intensity, basis: "(magnitude − 4) × 1,25, +1 se PAGER laranja, +2 se vermelho",
        status: reviewed ? "verificado" : "nao_verificado", confidence: reviewed ? 0.95 : 0.8,
        sourceId: "usgs", ref: f.id, url: p.url, retrievedAt: ctx.now,
        headline: `Terremoto de magnitude ${p.mag.toFixed(1).replace(".", ",")} — ${label}`,
        summary,
        magnitude: { value: round(p.mag, 1), scale: SCALE[(p.magType || "").toLowerCase()] || p.magType || "?" },
        depthKm: round(depth, 1),
        tags: [p.tsunami ? "oceanico" : null, p.alert ? `pager-${p.alert}` : null].filter(Boolean),
        clusterKey: `sismo:${Math.round(lat * 2) / 2}:${Math.round(lon * 2) / 2}:${Math.floor(p.time / 120000)}`,
        links: p.url ? [{ label: "Página do evento no USGS", url: p.url }] : [],
      }));
    }
    return out;
  },
};

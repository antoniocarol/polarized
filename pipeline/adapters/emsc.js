// EMSC — serviço FDSN de eventos sísmicos (JSON). Junta-se ao USGS por proximidade
// de hora e epicentro; as duas magnitudes viram uma medida com duas versões.
import { httpJson, clamp, round } from "../lib/util.js";
import { countryAt, countryByName, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const SCALE = { mw: "Mw", mww: "Mww", mb: "mb", ml: "ML", md: "Md", ms: "Ms" };
const title = s => String(s || "").toLowerCase().replace(/\b\w/g, m => m.toUpperCase());

export default {
  id: "emsc",
  fixture: "emsc.json",
  async fetch(ctx) {
    const start = new Date(Date.parse(ctx.now) - 2 * 864e5).toISOString().slice(0, 19);
    return httpJson(`${ctx.source.endpoint}?format=json&limit=300&orderby=time&minmag=${ctx.policy.events.minQuakeMagnitude}&start=${start}`);
  },
  normalize(raw, ctx) {
    const out = [];
    for (const f of raw.features || []) {
      const p = f.properties || {};
      if (p.evtype && p.evtype !== "ke") continue;   // ke = terremoto conhecido
      const lat = p.lat ?? f.geometry.coordinates[1], lon = p.lon ?? f.geometry.coordinates[0];
      const depth = Math.abs(p.depth ?? f.geometry.coordinates[2] ?? 0), mag = Number(p.mag);
      if (!(mag >= ctx.policy.events.minQuakeMagnitude)) continue;
      const region = title(p.flynn_region);
      const c = countryAt(lat, lon) || countryByName(String(p.flynn_region || "").split(",").pop().trim()) || countryByName(region);
      const t = Date.parse(p.time);
      out.push(entity({
        id: `emsc:evt:${p.unid || f.id}`, kind: "event", layer: "sismico", subtype: "terremoto",
        geo: point(lat, lon), place: placeOf(c, c ? null : region || null),
        start: t, observedAt: p.lastupdate || p.time, precision: "minute",
        intensity: clamp(Math.round((mag - 4) * 1.25), 0, 5), basis: "(magnitude − 4) × 1,25",
        status: "nao_verificado", confidence: 0.8,
        sourceId: "emsc", ref: p.unid || f.id, url: `https://www.seismicportal.eu/eventdetails.html?unid=${p.unid}`, retrievedAt: ctx.now,
        headline: `Terremoto de magnitude ${mag.toFixed(1).replace(".", ",")} — ${region || c?.pt || "região não informada"}`,
        summary: `Profundidade de ${round(depth, 1)} km. Solução da rede europeia EMSC.`,
        magnitude: { value: round(mag, 1), scale: SCALE[String(p.magtype).toLowerCase()] || p.magtype || "?" }, depthKm: round(depth, 1),
        clusterKey: `sismo:${Math.round(lat * 2) / 2}:${Math.round(lon * 2) / 2}:${Math.floor(t / 120000)}`,
      }));
    }
    return out;
  },
};

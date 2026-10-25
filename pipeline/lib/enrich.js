// Completa o estado (admin-1) de eventos com ponto e dá posição aos relatos com estado conhecido.
import { admin1At, admin1List, disputedAt, disputedArea } from "./geo.js";

export function enrichAdmin1(entities) {
  let n = 0;
  for (const e of entities) {
    if (e.kind === "event" && e.geo?.type === "Point" && e.place?.iso2 && !e.place.admin1Code) {
      const [lon, lat] = e.geo.coordinates;
      const a = admin1At(lat, lon, e.place.iso2);
      if (a) { e.place.admin1 = a.name; if (a.code) e.place.admin1Code = a.code; n++; }
    }
    if (e.kind === "report" && e.place?.admin1Code && !e.geo) {
      const a = admin1List(e.place.iso2).find(x => x.code === e.place.admin1Code);
      if (a) e.geo = { type: "Point", coordinates: [a.lon, a.lat] };
    }
  }
  return n;
}

/** Marca fatos e relatos que caem num território disputado (pipeline/data/disputed.json). */
export function enrichDisputed(entities) {
  for (const e of entities) {
    if (!e.place || !["condition", "event", "report"].includes(e.kind)) continue;
    const pt = e.geo?.type === "Point" ? e.geo.coordinates : null;
    // Condição no centro do país só herda a disputa quando o país inteiro é disputado (match por país).
    const id = disputedAt(e.place, e.kind === "condition" && !e.place.admin1Code ? null : pt?.[1] ?? null, pt?.[0] ?? null);
    if (id) e.place.disputed = id; else delete e.place.disputed;
  }
}
/** As áreas citadas, para snapshot.disputed. */
export function disputedFor(entities) {
  const out = {};
  for (const e of entities) { const id = e.place?.disputed; if (id && !out[id]) { const a = disputedArea(id); if (a) out[id] = { id: a.id, un: a.un, claims: a.claims, text: a.text }; } }
  return out;
}

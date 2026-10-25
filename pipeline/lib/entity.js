import { SCHEMA_VERSION, iso } from "./util.js";

/** Monta uma condição/evento no envelope comum do esquema. */
export function entity(o) {
  const e = {
    id: o.id, schemaVersion: SCHEMA_VERSION, kind: o.kind, layer: o.layer, subtype: o.subtype,
    geo: o.geo ?? null, place: o.place,
    time: { start: iso(o.start), end: o.end ? iso(o.end) : null, observedAt: iso(o.observedAt), precision: o.precision },
    intensity: o.intensity ?? null, intensityBasis: o.basis ?? null,
    status: o.status, confidence: o.confidence,
    sources: [{ sourceId: o.sourceId, ...(o.ref ? { ref: String(o.ref) } : {}), ...(o.url ? { url: o.url } : {}), retrievedAt: iso(o.retrievedAt) }],
    text: { pt: { headline: o.headline.slice(0, 140), summary: o.summary.slice(0, 320), ...(o.body ? { body: o.body } : {}) } },
    tags: o.tags || [], updatedAt: iso(o.observedAt),
  };
  if (o.links?.length) e.links = o.links;
  if (o.clusterKey) e.clusterKey = o.clusterKey;
  for (const k of ["magnitude", "depthKm", "parentId"]) if (o[k] !== undefined) e[k] = o[k];
  return e;
}

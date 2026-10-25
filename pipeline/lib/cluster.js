import { SCHEMA_VERSION, iso, round } from "./util.js";
import { readJson, rel } from "./util.js";

const THRESHOLD = readJson(rel("schema/taxonomy.json")).disputeThreshold;
const RANK = { nao_verificado: 0, corroborado: 1, verificado: 2, disputado: 1, retratado: -1 };

/**
 * Funde entidades com o mesmo clusterKey: uma entidade, várias fontes.
 * Magnitudes diferentes do mesmo sismo viram uma measure com uma assertion por rede.
 */
export function clusterEntities(entities, now) {
  const groups = new Map(), out = [], measures = [];
  for (const e of entities) {
    if (!e.clusterKey || (e.kind !== "event" && e.kind !== "condition")) { out.push(e); continue; }
    if (!groups.has(e.clusterKey)) groups.set(e.clusterKey, []);
    groups.get(e.clusterKey).push(e);
  }
  for (const list of groups.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    list.sort((a, b) => RANK[b.status] - RANK[a.status] || b.confidence - a.confidence);
    const head = structuredClone(list[0]);
    for (const other of list.slice(1)) {
      for (const s of other.sources) if (!head.sources.some(x => x.sourceId === s.sourceId)) head.sources.push(s);
      head.intensity = Math.max(head.intensity ?? 0, other.intensity ?? 0);
      for (const l of other.links || []) (head.links ||= []).push(l);
    }
    const distinct = new Set(head.sources.map(s => s.sourceId)).size;
    if (distinct >= 2 && head.status === "nao_verificado") head.status = "corroborado";
    head.confidence = round(Math.min(0.99, head.confidence + 0.05 * (distinct - 1)), 2);
    const mags = list.filter(e => e.magnitude?.value != null);
    if (mags.length >= 2) {
      const vals = mags.map(m => m.magnitude.value), lo = Math.min(...vals), hi = Math.max(...vals);
      const relative = lo ? round((hi - lo) / lo, 3) : 0;
      measures.push({
        id: `plz:measure:${head.id.split(":").pop()}-magnitude`, schemaVersion: SCHEMA_VERSION, kind: "measure",
        subject: { type: head.kind, id: head.id }, metric: "magnitude", unit: "Mw",
        periodStart: head.time.start, periodEnd: head.time.start,
        assertions: mags.map(m => ({ sourceId: m.sources[0].sourceId, value: m.magnitude.value, observedAt: m.time.observedAt, method: m.magnitude.scale })),
        spread: { low: lo, high: hi, relative }, disputed: relative > THRESHOLD, consensus: null, updatedAt: iso(now),
      });
    }
    out.push(head);
  }
  return [...out, ...measures];
}

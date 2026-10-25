import { SCHEMA_VERSION, iso, round, readJson, rel } from "./util.js";

const THRESHOLD = readJson(rel("schema/taxonomy.json")).disputeThreshold;
const RANK = { nao_verificado: 0, corroborado: 1, verificado: 2, disputado: 1, retratado: -1 };

function km(a, b) {
  const [lon1, lat1] = a.geo.coordinates, [lon2, lat2] = b.geo.coordinates, r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Redes sismológicas diferentes dão hora e epicentro um pouco diferentes: junta por proximidade. */
function linkQuakes(entities) {
  const q = entities.filter(e => e.layer === "sismico" && e.subtype === "terremoto" && e.geo)
    .sort((a, b) => a.time.start.localeCompare(b.time.start));
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
    const dt = (Date.parse(q[j].time.start) - Date.parse(q[i].time.start)) / 1000;
    if (dt > 90) break;
    if (q[i].sources[0].sourceId !== q[j].sources[0].sourceId && km(q[i], q[j]) < 100) q[j].clusterKey = q[i].clusterKey;
  }
}

function spreadOf(assertions) {
  const vals = assertions.map(a => a.value), lo = Math.min(...vals), hi = Math.max(...vals);
  const relative = lo ? round((hi - lo) / lo, 3) : hi ? 1 : 0;
  return { spread: { low: lo, high: hi, relative }, disputed: relative > THRESHOLD };
}

/**
 * Funde entidades com o mesmo clusterKey: uma entidade, várias fontes. Ids absorvidos
 * são remapeados em medidas e em parentId. Medidas do mesmo número sobre o mesmo fato
 * viram uma só, com uma versão por fonte.
 */
export function clusterEntities(entities, now) {
  linkQuakes(entities);
  const groups = new Map(), out = [], measures = [], remap = new Map();
  for (const e of entities) {
    if (e.kind === "measure") { measures.push(e); continue; }
    if (!e.clusterKey || (e.kind !== "event" && e.kind !== "condition")) { out.push(e); continue; }
    if (!groups.has(e.clusterKey)) groups.set(e.clusterKey, []);
    groups.get(e.clusterKey).push(e);
  }
  for (const list of groups.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    list.sort((a, b) => RANK[b.status] - RANK[a.status] || b.confidence - a.confidence);
    const head = structuredClone(list[0]);
    for (const other of list.slice(1)) {
      remap.set(other.id, head.id);
      for (const s of other.sources) if (!head.sources.some(x => x.sourceId === s.sourceId)) head.sources.push(s);
      head.intensity = Math.max(head.intensity ?? 0, other.intensity ?? 0);
      for (const l of other.links || []) if (!(head.links ||= []).some(x => x.url === l.url)) head.links.push(l);
      for (const t of other.tags || []) if (!head.tags.includes(t)) head.tags.push(t);
      for (const r of other.relations || []) if (!(head.relations ||= []).some(x => x.type === r.type && x.from === r.from && x.to === r.to)) head.relations.push(r);
      if (other.time.start < head.time.start && other.time.precision === head.time.precision) head.time.start = other.time.start;
    }
    const distinct = new Set(head.sources.map(s => s.sourceId)).size;
    if (distinct >= 2 && head.status === "nao_verificado") head.status = "corroborado";
    head.confidence = round(Math.min(0.99, head.confidence + 0.05 * (distinct - 1)), 2);
    const mags = list.filter(e => e.magnitude?.value != null);
    if (mags.length >= 2) {
      const assertions = mags.map(m => ({ sourceId: m.sources[0].sourceId, value: m.magnitude.value, observedAt: m.time.observedAt, method: m.magnitude.scale }));
      measures.push({
        id: `plz:measure:${head.id.split(":").pop()}-magnitude`, schemaVersion: SCHEMA_VERSION, kind: "measure",
        subject: { type: head.kind, id: head.id }, metric: "magnitude", unit: "Mw",
        periodStart: head.time.start, periodEnd: head.time.start,
        assertions, ...spreadOf(assertions), consensus: null, updatedAt: iso(now),
      });
    }
    out.push(head);
  }
  for (const e of out) if (e.parentId && remap.has(e.parentId)) e.parentId = remap.get(e.parentId);

  // Medidas: remapeia o fato e junta as que medem a mesma coisa.
  const byKey = new Map();
  for (const m0 of measures) {
    const m = structuredClone(m0);
    if (remap.has(m.subject.id)) m.subject.id = remap.get(m.subject.id);
    const key = `${m.subject.id}|${m.metric}|${m.unit}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, m); continue; }
    for (const a of m.assertions) {
      const i = prev.assertions.findIndex(x => x.sourceId === a.sourceId && x.method === a.method);
      if (i < 0) prev.assertions.push(a); else if (a.observedAt > prev.assertions[i].observedAt) prev.assertions[i] = a;
    }
    if (m.periodStart < prev.periodStart) prev.periodStart = m.periodStart;
    if (m.periodEnd > prev.periodEnd) prev.periodEnd = m.periodEnd;
  }
  for (const m of byKey.values()) Object.assign(m, spreadOf(m.assertions));
  return [...out, ...byKey.values()];
}

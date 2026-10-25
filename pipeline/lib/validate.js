import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readJson, rel } from "./util.js";

const schema = readJson(rel("schema/polarized.schema.json"));
const taxonomy = readJson(rel("schema/taxonomy.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const check = ajv.compile(schema);
export const validateEntity = ajv.compile({ $ref: "#/$defs/entity", $defs: schema.$defs });

/**
 * Valida o snapshot contra o JSON Schema e contra as regras que o schema não expressa.
 * Devolve { errors, warnings }. Um snapshot com errors não é publicado.
 */
export function validateSnapshot(snap) {
  const errors = [], warnings = [];
  if (!check(snap)) {
    for (const e of check.errors.slice(0, 40)) errors.push(`${e.instancePath || "/"} ${e.message}`);
    return { errors, warnings };
  }
  const ids = new Map();
  for (const e of snap.entities) {
    if (ids.has(e.id)) errors.push(`id duplicado: ${e.id}`);
    ids.set(e.id, e);
  }
  for (const e of snap.entities) {
    const refs = [...(e.sources || []).map(s => s.sourceId)];
    if (e.kind === "measure") {
      refs.push(...e.assertions.map(a => a.sourceId));
      if (!ids.has(e.subject.id)) errors.push(`${e.id}: subject inexistente ${e.subject.id}`);
      if (e.disputed !== e.spread.relative > taxonomy.disputeThreshold) errors.push(`${e.id}: disputed inconsistente com spread`);
    } else if (e.kind !== "analysis" && !(e.subtype in taxonomy.layers[e.layer].subtypes)) {
      errors.push(`${e.id}: subtype "${e.subtype}" fora da taxonomia de ${e.layer}`);
    }
    if (e.kind === "analysis") {
      for (const s of e.subjectIds) if (!ids.has(s)) errors.push(`${e.id}: subjectId inexistente ${s}`);
      const supports = [...e.points, e.counterpoint, ...(e.claims || [])].flatMap(p => p.supportedBy);
      for (const s of supports) {
        if (s.entityId && !ids.has(s.entityId)) errors.push(`${e.id}: apoio aponta para entidade inexistente ${s.entityId}`);
        if (s.precedent != null && !(e.precedents || [])[s.precedent]) errors.push(`${e.id}: apoio aponta para precedente inexistente ${s.precedent}`);
        if (s.sourceId) refs.push(s.sourceId);
      }
      if (e.review.status === "rejeitada") errors.push(`${e.id}: análise rejeitada não pode ser publicada`);
    }
    for (const r of refs) if (!snap.sources[r]) errors.push(`${e.id}: fonte "${r}" não registrada`);
  }
  if (snap.dataClass !== "example") {
    for (const [id, s] of Object.entries(snap.sources)) {
      if (s.licenseCheckedAt == null) warnings.push(`licença de "${id}" ainda não conferida`);
    }
  }
  return { errors, warnings };
}

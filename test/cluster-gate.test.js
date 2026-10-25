import test from "node:test";
import assert from "node:assert/strict";
import { NOW, policy, registry, fixture } from "./helpers.js";
import { clusterEntities } from "../pipeline/lib/cluster.js";
import { applyLicenseGate } from "../pipeline/lib/gate.js";
import usgs from "../pipeline/adapters/usgs.js";

test("duas redes, mesmo sismo: uma entidade, duas fontes e medida de magnitude", () => {
  const [a] = usgs.normalize(fixture("usgs.json"), { now: NOW, policy }).filter(e => e.id.endsWith("jp01"));
  const b = structuredClone(a);
  b.id = "emsc:evt:x1"; b.sources = [{ sourceId: "emsc", retrievedAt: NOW }]; b.magnitude = { value: 6.0, scale: "mb" }; b.status = "nao_verificado";
  const out = clusterEntities([a, b], NOW);
  const ev = out.filter(e => e.kind === "event");
  const m = out.find(e => e.kind === "measure");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].sources.map(s => s.sourceId).sort(), ["emsc", "usgs"]);
  assert.deepEqual(m.assertions.map(x => x.value).sort(), [6, 6.1]);
  assert.equal(m.disputed, false);
});

test("trava de licença barra fontes 'verificar' não conferidas e libera as conferidas", () => {
  const e = src => ({ id: `${src}:evt:1`, sources: [{ sourceId: src }] });
  const reg = structuredClone(registry);
  let g = applyLicenseGate([e("usgs"), e("ioda")], [{ sourceId: "opensky" }], reg, policy);
  assert.deepEqual(g.kept.map(x => x.id), ["usgs:evt:1"]);
  assert.equal(g.observations.length, 0);
  reg.ioda.licenseCheckedAt = "2026-10-01T00:00:00Z";
  g = applyLicenseGate([e("usgs"), e("ioda")], [], reg, policy);
  assert.equal(g.kept.length, 2);
});

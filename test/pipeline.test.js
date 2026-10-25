import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../pipeline/run.js";
import { validateSnapshot } from "../pipeline/lib/validate.js";
import { rel } from "../pipeline/lib/util.js";

test("snapshot de fixtures completo passa na validação", async () => {
  const { snapshot } = await build({ fixtures: true, now: "2026-10-25T17:00:00Z", statePath: rel("pipeline/fixtures/state.json"), log: () => {} });
  const { errors } = validateSnapshot(snapshot);
  assert.deepEqual(errors, []);
  const kinds = snapshot.entities.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {});
  assert.ok(kinds.track >= 5 && kinds.analysis === 6 && kinds.event >= 10 && kinds.report >= 20 && kinds.series >= 5, JSON.stringify(kinds));
  assert.equal(snapshot.dataClass, "example");
  assert.ok(snapshot.ingest.every(r => r.status === "fixture"), JSON.stringify(snapshot.ingest));
  assert.equal(snapshot.ingest.length, 19);
  assert.ok(Object.keys(snapshot.outlets).every(k => k.startsWith("ex_")), "exemplo usa só veículos fictícios");
});

test("entidade malformada de uma fonte é descartada sem derrubar o snapshot", async () => {
  const { ADAPTERS } = await import("../pipeline/run.js");
  const usgs = ADAPTERS.find(a => a.id === "usgs");
  const orig = usgs.normalize;
  usgs.normalize = (raw, ctx) => { const out = orig(raw, ctx); out[0].place.iso2 = "inválido"; return out; };
  try {
    const { snapshot } = await build({ fixtures: true, now: "2026-10-25T17:00:00Z", statePath: rel("pipeline/fixtures/state.json"), analysis: false, log: () => {} });
    assert.deepEqual(validateSnapshot(snapshot).errors, []);
    const row = snapshot.ingest.find(r => r.sourceId === "usgs");
    assert.equal(row.rejected, 1);
    assert.match(row.error, /place\/iso2/);
  } finally { usgs.normalize = orig; }
});

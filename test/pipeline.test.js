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
  assert.ok(kinds.track >= 5 && kinds.analysis === 3 && kinds.event >= 10, JSON.stringify(kinds));
  assert.equal(snapshot.dataClass, "example");
  assert.ok(snapshot.ingest.every(r => r.status === "fixture"), JSON.stringify(snapshot.ingest));
});

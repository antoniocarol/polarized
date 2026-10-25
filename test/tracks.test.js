import test from "node:test";
import assert from "node:assert/strict";
import { NOW, policy, fixture } from "./helpers.js";
import { mergeTracks } from "../pipeline/lib/tracks.js";
import { validateEntity } from "../pipeline/lib/validate.js";
import opensky from "../pipeline/adapters/opensky.js";

const obs = () => opensky.normalize(fixture("opensky.json"), {}).observations;

test("amostras recentes em zona de conflito não são publicadas antes do atraso", () => {
  const { state, published } = mergeTracks(fixture("state.json"), obs(), { now: NOW, policy });
  const forteState = state.find(t => t.asset.callsign === "FORTE12");
  const fortePub = published.find(t => t.asset.callsign === "FORTE12");
  assert.ok(forteState.samples.some(s => s.t === "2026-10-25T16:59:00Z"), "o estado privado guarda a amostra atual");
  assert.ok(!fortePub.samples.some(s => s.t === "2026-10-25T16:59:00Z"), "o snapshot público não");
  assert.equal(fortePub.releaseDelayMinutes, 60);
  const rch = published.find(t => t.asset.callsign === "RCH871");
  assert.equal(rch.releaseDelayMinutes, 0);
  assert.equal(rch.samples.at(-1).t, "2026-10-25T16:59:00Z");
  for (const t of published) assert.ok(validateEntity(t), JSON.stringify(validateEntity.errors));
});

test("histórico mais velho que a janela é podado", () => {
  const later = new Date(Date.parse(NOW) + 4 * 3600e3).toISOString().replace(/\.\d+Z/, "Z");
  const { state } = mergeTracks(fixture("state.json"), [], { now: later, policy });
  assert.equal(state.length, 0);
});

test("trilha sem sinal recente muda de status", () => {
  const later = new Date(Date.parse(NOW) + 30 * 60e3).toISOString().replace(/\.\d+Z/, "Z");
  const { state } = mergeTracks(fixture("state.json"), obs(), { now: later, policy });
  assert.equal(state.find(t => t.asset.callsign === "RCH871").trackStatus, "stale");
});

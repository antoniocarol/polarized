import test from "node:test";
import assert from "node:assert/strict";
import { NOW, policy, registry } from "./helpers.js";
import { runAnalysis } from "../pipeline/lib/analysis.js";
import { validateEntity } from "../pipeline/lib/validate.js";
import { readJson, rel } from "../pipeline/lib/util.js";

const curated = readJson(rel("data/curated/example.json")).entities;
const fx = readJson(rel("pipeline/fixtures/analyses.json"));

function fakeClient(reply) {
  const calls = [];
  return { calls, beta: { messages: { create: async req => { calls.push(req); return typeof reply === "function" ? reply(req) : reply; } } } };
}
const okReply = key => ({ stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(fx[key].output) }] });

test("chama o Claude com saída estruturada e fallback, e grava a análise válida", async () => {
  const key = "wto:cond:eu-regulacao-comercial|impacto";
  const client = fakeClient(okReply(key));
  const p = { ...policy, analysis: { ...policy.analysis, maxPerRun: 1, minIntensity: 9 } };
  const { analyses, report } = await runAnalysis(curated.filter(e => e.id === key.split("|")[0]), { now: NOW, policy: p, sources: registry, client });
  assert.equal(report.generated, 1);
  const req = client.calls[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.match(req.messages[0].content, /Nunca dê probabilidade/);
  assert.match(req.messages[0].content, /wto:cond:eu-regulacao-comercial/);
  const a = analyses[0];
  assert.ok(validateEntity(a), JSON.stringify(validateEntity.errors?.slice(0, 3)));
  assert.equal(a.method.provider, "anthropic");
  assert.equal(a.review.status, "pendente");
});

test("recusa do modelo não derruba o estágio", async () => {
  const client = fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] });
  const subj = curated.filter(e => e.id === "wto:cond:eu-regulacao-comercial");
  const { analyses, report } = await runAnalysis(subj, { now: NOW, policy, sources: registry, client, log: () => {} });
  assert.equal(analyses.length, 0);
  assert.equal(report.failed, 1);
});

test("saída que viola as guardas é descartada", async () => {
  const bad = structuredClone(fx["wto:cond:eu-regulacao-comercial|impacto"].output);
  bad.summary = "Há 80% de chance de dar certo.";
  const client = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(bad) }] });
  const subj = curated.filter(e => e.id === "wto:cond:eu-regulacao-comercial");
  const { analyses, report } = await runAnalysis(subj, { now: NOW, policy, sources: registry, client, log: () => {} });
  assert.equal(analyses.length, 0);
  assert.equal(report.rejected, 1);
});

test("reaproveita análise anterior do mesmo fato e da mesma versão de prompt", async () => {
  const key = "wto:cond:eu-regulacao-comercial|impacto";
  const subj = curated.filter(e => e.id === key.split("|")[0]);
  const first = await runAnalysis(subj, { now: NOW, policy, sources: registry, client: fakeClient(okReply(key)) });
  const client = fakeClient(() => { throw new Error("não deveria chamar"); });
  const again = await runAnalysis(subj, { now: NOW, policy, sources: registry, client, prevAnalyses: first.analyses });
  assert.equal(again.report.reused, 1);
  assert.equal(client.calls.length, 0);
});

test("revisão humana rejeitada tira a análise do snapshot", async () => {
  const key = "wto:cond:eu-regulacao-comercial|impacto";
  const subj = curated.filter(e => e.id === key.split("|")[0]);
  const first = await runAnalysis(subj, { now: NOW, policy, sources: registry, client: fakeClient(okReply(key)) });
  const id = first.analyses[0].id;
  const r = await runAnalysis(subj, { now: NOW, policy, sources: registry, prevAnalyses: first.analyses,
    reviews: { [id]: { status: "rejeitada", reviewer: "x", at: NOW, note: "n" } } });
  assert.equal(r.analyses.length, 0);
});

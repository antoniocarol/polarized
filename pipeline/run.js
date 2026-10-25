// Orquestrador: fontes -> normalização -> trilhas -> agrupamento -> análise -> validação -> snapshot.
// uso: node pipeline/run.js [--fixtures] [--now ISO] [--out caminho] [--only usgs,gdacs] [--no-analysis]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT, SCHEMA_VERSION, iso, readJson, readJsonIf, rel, writeJson } from "./lib/util.js";
import { mergeTracks } from "./lib/tracks.js";
import { applyLicenseGate, blockedSources } from "./lib/gate.js";
import { clusterEntities } from "./lib/cluster.js";
import { runAnalysis, defaultClient, askClassifier, askTranslator } from "./lib/analysis.js";
import { translateSnapshot, validateOverlay } from "./lib/translate.js";
import { classifyReports } from "./lib/classify.js";
import { clusterStories, attachReports } from "./lib/stories.js";
import { enrichAdmin1, enrichDisputed, disputedFor } from "./lib/enrich.js";
import { validateSnapshot, validateEntity } from "./lib/validate.js";
import usgs from "./adapters/usgs.js";
import gdacs from "./adapters/gdacs.js";
import opensky from "./adapters/opensky.js";
import aisstream from "./adapters/aisstream.js";
import cisaKev from "./adapters/cisa_kev.js";
import ioda from "./adapters/ioda.js";
import curated from "./adapters/curated.js";
import elections from "./adapters/elections.js";
import emsc from "./adapters/emsc.js";
import cloudflare from "./adapters/cloudflare_radar.js";
import ucdp from "./adapters/ucdp.js";
import acled from "./adapters/acled.js";
import { ofac, unsc, eu } from "./adapters/sanctions.js";
import { rss, bluesky, x } from "./adapters/news.js";
import markets from "./adapters/markets.js";

export const ADAPTERS = [curated, elections, usgs, emsc, gdacs, ioda, cloudflare, cisaKev, ucdp, acled, ofac, unsc, eu, rss, bluesky, x, markets, opensky, aisstream];

export async function build({ fixtures = false, now = iso(Date.now()), only = null, analysis = true, client, statePath, prevPath, log = console.log } = {}) {
  const registry = Object.fromEntries(readJson(rel("schema/sources.json")).sources.map(s => [s.id, s]));
  const policy = readJson(rel("pipeline/policy.json"));
  const state = readJsonIf(statePath) || {};
  const outletList = readJson(rel(fixtures ? "pipeline/fixtures/outlets.json" : "schema/outlets.json")).outlets;
  const outlets = Object.fromEntries(outletList.map(o => [o.id, o]));
  const aiClient = fixtures ? null : client === undefined ? defaultClient() : client;
  const prev = readJsonIf(prevPath);
  const ingest = [], entities = [], observations = [];
  const extraSources = {};
  const blocked = fixtures ? new Set() : blockedSources(registry, policy);

  for (const a of ADAPTERS) {
    if (only && !only.includes(a.id)) continue;
    const t0 = Date.now();
    const row = { sourceId: a.id, status: "ok", count: 0, fetchedAt: now, error: null };
    try {
      const ctx = { now, policy, source: registry[a.id], fixtures, state, outlets: outletList };
      let raw;
      if (fixtures && a.fixture) {
        const f = rel("pipeline/fixtures", a.fixture);
        raw = f.endsWith(".json") ? readJson(f) : fs.readFileSync(f, "utf8");
        row.status = "fixture";
      }
      else if (fixtures && a.fixture === undefined) { row.status = "desativada"; ingest.push(row); continue; }
      else if (blocked.has(a.id)) {
        // Não consulta fonte que não poderia ser publicada.
        row.status = "bloqueada_licenca"; row.error = "licença não conferida em schema/sources.json"; ingest.push(row); continue;
      } else {
        const missing = (a.needs || []).filter(k => !process.env[k]);
        if (!fixtures && missing.length) { row.status = "sem_credencial"; row.error = `faltando ${missing.join(", ")}`; ingest.push(row); continue; }
        raw = await a.fetch(ctx);
        if (fixtures) row.status = "fixture";
      }
      const res = a.normalize(raw, ctx);
      // Uma entidade malformada não derruba o snapshot: sai sozinha e fica registrada.
      const list = [];
      for (const e of Array.isArray(res) ? res : res.entities || []) {
        if (validateEntity(e)) list.push(e);
        else { row.rejected = (row.rejected || 0) + 1; row.error ||= `${e.id || "?"}: ${validateEntity.errors[0].instancePath} ${validateEntity.errors[0].message}`; }
      }
      entities.push(...list);
      observations.push(...(res.observations || []));
      Object.assign(extraSources, res.sources || {});
      if (res.warnings?.length) row.error ||= `${res.warnings.length} itens com falha: ${res.warnings.slice(0, 3).join("; ")}`.slice(0, 300);
      row.count = list.length + (res.observations || []).length;
    } catch (e) {
      row.status = "falhou"; row.error = String(e.message || e).slice(0, 300);
    }
    row.ms = Date.now() - t0;
    ingest.push(row);
    log(`${a.id.padEnd(10)} ${row.status.padEnd(15)} ${String(row.count).padStart(5)}  ${row.error || ""}`);
  }

  // Trava de licença: em produção, fonte cujo direito de redistribuição não foi conferido não sai.
  let kept = entities, obs = observations;
  if (!fixtures) {
    const gate = applyLicenseGate(entities, observations, registry, policy);
    kept = gate.kept; obs = gate.observations;
    for (const row of ingest) if (gate.blocked.has(row.sourceId) && row.status === "ok") {
      row.status = "bloqueada_licenca"; row.error = "licença não conferida em schema/sources.json";
    }
  }

  const tracks = mergeTracks(state, obs, { now, policy });

  // Notícias: classifica (palavras-chave sempre; modelo só para as novas), agrupa em histórias.
  const reports = kept.filter(e => e.kind === "report");
  const cls = await classifyReports(reports, { client: aiClient, ask: askClassifier, cache: state.reports || {}, now, log, batchSize: policy.news.classifyBatch });
  clusterStories(reports, { threshold: policy.news.storyThreshold, hours: policy.news.storyHours });
  enrichAdmin1(kept);
  enrichDisputed(kept);
  if (reports.length) log(`notícias   ${reports.length} relatos, ${new Set(reports.map(r => r.storyKey)).size} histórias, ${cls.calls} chamadas ao modelo`);

  const merged = clusterEntities(kept, now);
  const present = new Set(merged.map(e => e.id));
  const clustered = merged.filter(e => e.kind !== "measure" || present.has(e.subject.id));
  for (const e of clustered) if (e.parentId && !present.has(e.parentId)) delete e.parentId;
  attachReports(clustered.filter(e => e.kind === "report"), clustered);

  const sources = { ...extraSources };
  const allSoFar = [...clustered, ...tracks.published];
  const used = new Set(allSoFar.flatMap(e => [...(e.sources || []), ...(e.assertions || [])].map(s => s.sourceId)));
  for (const id of [...used, ...ingest.map(r => r.sourceId)]) if (registry[id]) sources[id] = registry[id];

  let analyses = [], analysisReport = null;
  if (analysis) {
    const reviews = Object.assign({}, ...fs.readdirSync(rel("data/reviews")).filter(f => f.endsWith(".json")).map(f => readJson(rel("data/reviews", f))));
    const fx = fixtures ? readJsonIf(rel("pipeline/fixtures/analyses.json")) : null;
    const r = await runAnalysis(clustered, { now, policy, sources, outlets, reviews, fixtures: fx, log,
      prevAnalyses: (prev?.entities || []).filter(e => e.kind === "analysis"), client: aiClient });
    analyses = r.analyses; analysisReport = r.report;
    log(`análise    ${JSON.stringify(r.report)}`);
  }

  const snapshot = {
    schemaVersion: SCHEMA_VERSION, generatedAt: now,
    window: { from: iso(Date.parse(now) - 7 * 864e5), to: now },
    dataClass: fixtures ? "example" : "live",
    sources, outlets, ingest, disputed: disputedFor([...clustered]),
    policy: { militaryTrackZones: policy.militaryTracks.zones.map(z => ({ name: z.name, delayMinutes: z.delayMinutes })), analysis: analysisReport },
    entities: [...clustered, ...tracks.published, ...analyses],
  };
  // Tradução do conteúdo para os idiomas do app (text/<idioma>.json), com cache e conferência de números.
  let translations = null, trCache = state.translations || {};
  if (policy.translation?.enabled !== false) {
    const fx = fixtures ? readJsonIf(rel("pipeline/fixtures/translations.json")) : null;
    const tr = await translateSnapshot(snapshot, { client: fixtures ? null : aiClient, ask: askTranslator, cache: trCache, now, log, policy: policy.translation || {}, fixtures: fx });
    translations = tr.overlays; trCache = tr.cache;
    snapshot.policy.translation = { languages: Object.keys(tr.overlays), ...tr.report };
    log(`tradução   ${JSON.stringify(tr.report)}`);
  }
  return { snapshot, translations, state: { tracks: tracks.state, militaryMmsi: tracks.militaryMmsi, reports: cls.cache, translations: trCache } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: {
    fixtures: { type: "boolean", default: false }, now: { type: "string" }, out: { type: "string", default: "public/snapshot.json" },
    state: { type: "string", default: "state/tracks.json" }, only: { type: "string" }, "no-analysis": { type: "boolean", default: false } } });
  const out = path.resolve(ROOT, v.out);
  const { snapshot, state, translations } = await build({
    fixtures: v.fixtures, now: v.now ? iso(v.now) : undefined, only: v.only?.split(","), analysis: !v["no-analysis"],
    // Com fixtures, nada é reaproveitado da execução anterior: o exemplo é sempre reconstruído do zero.
    statePath: v.fixtures ? rel("pipeline/fixtures/state.json") : path.resolve(ROOT, v.state), prevPath: v.fixtures ? null : out,
  });
  const { errors, warnings } = validateSnapshot(snapshot);
  for (const w of warnings) console.log("AVISO", w);
  if (errors.length) {
    for (const e of errors) console.error("ERRO ", e);
    console.error(`snapshot inválido (${errors.length} erros); o anterior foi mantido`);
    process.exit(1);
  }
  writeJson(out, snapshot);
  for (const [lang, ov] of Object.entries(translations || {})) {
    const errs = validateOverlay(ov, snapshot);
    if (errs.length) { console.error(`text/${lang}.json não gravado: ${errs.slice(0, 3).join("; ")}`); continue; }
    writeJson(path.join(path.dirname(out), "text", `${lang}.json`), ov);
  }
  if (!v.fixtures) writeJson(path.resolve(ROOT, v.state), state);
  console.log(`${v.out}: ${snapshot.entities.length} entidades`);
}

import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA_VERSION, iso, round, slug } from "./util.js";
import { PROMPT_VERSION, OUTPUT_SCHEMA, analysisTypeFor, buildPrompt, factsFor as sharedFactsFor } from "./prompt.js";
import { applyGuards, crossCompare } from "./guards.js";
import { attentionByCountry } from "./attention.js";
import { country } from "./geo.js";

export const MODEL = process.env.POLARIZED_MODEL || "claude-opus-5-5";
export const CLASSIFIER_MODEL = process.env.POLARIZED_CLASSIFIER_MODEL || MODEL;
// Tradução é volume alto e tarefa simples: vale apontar POLARIZED_TRANSLATE_MODEL para um modelo menor (claude-haiku-5-5).
export const TRANSLATE_MODEL = process.env.POLARIZED_TRANSLATE_MODEL || MODEL;

/** Cliente Claude se houver credencial no ambiente; senão null e os estágios de IA são pulados. */
export function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic();
}

/** Uma chamada ao Claude com saída estruturada. Devolve o objeto ou lança com motivo legível. */
// Modelos com fallback no servidor quando o modelo recusa (o Haiku não tem: ali a recusa só é registrada).
const SERVER_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
export async function askClaude(client, prompt, schema = OUTPUT_SCHEMA, { effort = "high", model = MODEL } = {}) {
  const fb = SERVER_FALLBACK.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
  const res = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    ...fb,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error(`recusado (${res.stop_details?.category ?? "sem categoria"})`);
  if (res.stop_reason === "max_tokens") throw new Error("resposta cortada por max_tokens");
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  return { data: JSON.parse(text), model: res.model };
}
const isFact = e => e.kind === "condition" || e.kind === "event";
const byIntensity = (a, b) => (b.intensity ?? 0) - (a.intensity ?? 0);
export const factsFor = (job, all, ctx) => sharedFactsFor(job, all, { attention: attentionByCountry, ...ctx });
export const askClassifier = (client, prompt, schema) => askClaude(client, prompt, schema, { effort: "low", model: CLASSIFIER_MODEL });
export const askTranslator = (client, prompt, schema) => askClaude(client, prompt, schema, { effort: "low", model: TRANSLATE_MODEL });

/**
 * Segundo modelo, opcional, para conferência cruzada. Qualquer endpoint compatível com
 * /chat/completions serve (Ollama local, Groq, OpenRouter e outros com plano gratuito).
 */
export async function askCrossChecker(prompt) {
  const base = process.env.CROSSCHECK_BASE_URL, model = process.env.CROSSCHECK_MODEL;
  if (!base || !model) return null;
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.CROSSCHECK_API_KEY ? { authorization: `Bearer ${process.env.CROSSCHECK_API_KEY}` } : {}) },
    body: JSON.stringify({ model, response_format: { type: "json_object" },
      messages: [{ role: "user", content: `${prompt}\n\nFormato (JSON Schema):\n${JSON.stringify(OUTPUT_SCHEMA)}` }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`conferência cruzada: HTTP ${res.status}`);
  const body = await res.json();
  return { data: JSON.parse(body.choices[0].message.content), model };
}

// No formato do modelo cada referência tem os dois campos (um deles null); na entidade, só o que existe.
const refs = list => (list || []).map(s => (s.entityId != null ? { entityId: s.entityId } : { precedent: s.precedent }));
const withRefs = list => (list || []).map(x => ({ ...x, supportedBy: refs(x.supportedBy) }));
const QUESTION = { precedente: "Já foi tentado antes, e deu certo?", impacto: "O que isso muda, e para quem?", checagem: "O que foi dito confere?",
  contexto: "Como se chegou aqui?", mercado: "Por que o mercado se mexeu assim?", panorama: "O que importa agora?" };

export function analysisId(job, now) {
  const day = iso(now).slice(0, 10);
  if (job.type === "panorama") return `plz:analysis:panorama-${job.scope.type === "mundo" ? "mundo" : job.scope.iso2.toLowerCase()}-${day}`;
  if (job.type === "mercado") return `plz:analysis:mercado-${slug(job.subject.instrument.symbol) || "serie"}-${day}`;
  return `plz:analysis:${slug(job.subject.id)}-${job.type}${job.region ? "-" + (job.region.iso2 || slug(job.region.name)).toLowerCase() : ""}`;
}

/** Converte a saída aprovada pelas guardas em entidade do esquema. */
export function toAnalysisEntity({ job, guarded, method, crossCheck, review, now, facts, all }) {
  const g = guarded.analysis;
  const a = { ...g, points: withRefs(g.points), claims: withRefs(g.claims),
    moves: (g.moves || []).map(m => ({ ...m, drivers: withRefs(m.drivers) })),
    counterpoint: { ...g.counterpoint, supportedBy: refs(g.counterpoint.supportedBy) } };
  const used = new Set(facts.map(f => f.entityId));
  const sources = [];
  for (const e of all) if (used.has(e.id)) for (const s of e.sources || []) if (!sources.some(x => x.sourceId === s.sourceId)) sources.push(s);
  const subject = job.subject;
  const subjectIds = subject ? [subject.id] : facts.filter(f => f.kind !== "report").slice(0, 8).map(f => f.entityId);
  const baseConf = subject ? Math.min(subject.confidence, 0.8) : 0.7;
  const layer = subject?.layer || all.find(e => e.id === subjectIds[0])?.layer || "conflito";
  return {
    id: analysisId(job, now), schemaVersion: SCHEMA_VERSION, kind: "analysis", analysisType: job.type,
    subjectIds: subjectIds.length ? subjectIds : facts.slice(0, 1).map(f => f.entityId), layer,
    scope: job.scope || { type: subject?.kind === "series" ? "serie" : "fato", iso2: subject?.place?.iso2 || null },
    question: QUESTION[job.type], region: job.region || null,
    text: { pt: { headline: String(a.headline || subject?.text?.pt?.headline || subject?.instrument?.name || "Panorama").slice(0, 140), summary: String(a.summary || "").slice(0, 320) || "Análise sem resumo." } },
    points: a.points, precedents: a.precedents, conditions: a.conditions || [], impacts: a.impacts || [], claims: a.claims || [],
    moves: a.moves || [], watch: a.watch || [],
    counterpoint: a.counterpoint, limits: a.limits || "Sem limites declarados pelo modelo.",
    method: { ...method, promptVersion: PROMPT_VERSION, generatedAt: iso(now) },
    crossCheck: crossCheck || null,
    review: review || { status: "pendente", reviewer: null, at: null, note: null },
    guards: guarded.guards,
    status: review?.status === "aprovada" ? "verificado" : "nao_verificado",
    confidence: round(baseConf * (crossCheck ? crossCheck.agreement : 0.85), 2),
    sources: sources.length ? sources : (subject?.sources || all.find(e => e.sources)?.sources),
    updatedAt: iso(now),
  };
}

const jobKey = j => (j.type === "panorama" ? (j.scope.type === "mundo" ? "mundo" : `pais:${j.scope.iso2}`) : j.subject.id) + "|" + j.type;

/** Lista de trabalhos do estágio, em ordem de prioridade. */
export function planAnalyses(entities, policy, now) {
  const P = policy.analysis, jobs = [];
  if (P.worldPanorama) jobs.push({ type: "panorama", scope: { type: "mundo", iso2: null }, daily: true });
  for (const s of entities.filter(e => e.kind === "series" && e.subtype === "indice_bolsa")
    .sort((a, b) => Math.abs(b.last.changePct || 0) - Math.abs(a.last.changePct || 0)).slice(0, P.marketMax || 0))
    jobs.push({ type: "mercado", subject: s, daily: true });
  const att = Object.values(attentionByCountry(entities, now)).sort((a, b) => b.score - a.score).slice(0, P.countryPanoramas || 0);
  for (const c of att) { const k = country(c.iso2); if (k) jobs.push({ type: "panorama", scope: { type: "pais", iso2: c.iso2 }, region: { iso2: c.iso2, name: k.pt }, daily: true }); }
  for (const e of entities.filter(e => isFact(e) && P.layers.includes(e.layer) && ((e.intensity ?? 0) >= P.minIntensity || (e.tags || []).includes("analisar")))
    .sort((a, b) => byIntensity(a, b) || b.updatedAt.localeCompare(a.updatedAt)))
    jobs.push({ type: analysisTypeFor(e), subject: e, daily: false });
  return jobs;
}

/**
 * Estágio de análise. Reaproveita análises anteriores (diárias: do mesmo dia; de fato: se o
 * fato não mudou), chama o modelo para o resto dentro do orçamento da execução.
 */
export async function runAnalysis(entities, { now, policy, sources, outlets = {}, prevAnalyses = [], reviews = {}, client, fixtures = null, log = () => {} }) {
  const P = policy.analysis;
  const ctx = { now, measures: entities.filter(e => e.kind === "measure"), outlets, attention: attentionByCountry,
    sourceNames: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.shortName || v.name])) };
  const prev = new Map(prevAnalyses.map(a => [`${a.scope?.type === "mundo" ? "mundo" : a.scope?.type === "pais" ? `pais:${a.scope.iso2}` : a.subjectIds[0]}|${a.analysisType}`, a]));
  const out = [], report = { reused: 0, generated: 0, rejected: 0, failed: 0, skipped: 0 };
  let budget = P.maxPerRun;
  const today = iso(now).slice(0, 10);

  for (const job of planAnalyses(entities, policy, now)) {
    const key = jobKey(job), old = prev.get(key);
    const fresh = old && old.method.promptVersion === PROMPT_VERSION &&
      (job.daily ? old.method.generatedAt.slice(0, 10) === today : old.method.generatedAt >= job.subject.updatedAt);
    if (fresh && old.subjectIds.every(id => entities.some(e => e.id === id))) {
      const review = reviews[old.id];
      if (review?.status === "rejeitada") continue;
      out.push(review ? { ...old, review, status: review.status === "aprovada" ? "verificado" : old.status } : old);
      report.reused++;
      continue;
    }
    const fixture = fixtures?.[key];
    if (!fixture && (!client || budget <= 0)) { report.skipped++; continue; }
    const facts = factsFor(job, entities, ctx);
    const prompt = buildPrompt({ type: job.type, facts, region: job.region, scope: job.scope });
    try {
      let main, method;
      if (fixture) { main = { data: fixture.output }; method = fixture.method; }
      else { budget--; main = await askClaude(client, prompt); method = { provider: "anthropic", model: main.model || MODEL, effort: "high" }; }
      const guarded = applyGuards(main.data, facts, job.type);
      if (guarded.rejected) {
        report.rejected++;
        log(`análise descartada (${key}): ${guarded.guards.filter(g => !g.passed).map(g => g.detail).join("; ")}`);
        continue;
      }
      let crossCheck = null;
      const second = fixture ? null : await askCrossChecker(prompt).catch(e => (log(e.message), null));
      if (second) {
        const g2 = applyGuards(second.data, facts, job.type);
        crossCheck = { provider: "openai-compatible", model: second.model, ...crossCompare(guarded.analysis, g2.analysis) };
        guarded.guards.push({ rule: "conferencia_cruzada", passed: crossCheck.agreement >= P.crossCheckMinAgreement,
          detail: `concordância ${Math.round(crossCheck.agreement * 100)}% com ${second.model}` });
      }
      const entity = toAnalysisEntity({ job, guarded, method, crossCheck, now, facts, all: entities, review: reviews[analysisId(job, now)] });
      if (entity.review.status === "rejeitada") continue;
      out.push(entity);
      report.generated++;
    } catch (e) {
      report.failed++;
      if (e instanceof Anthropic.RateLimitError) { log("limite de uso da API atingido; análises restantes ficam para a próxima execução"); break; }
      log(`análise falhou (${key}): ${e.message}`);
    }
  }
  return { analyses: out, report };
}

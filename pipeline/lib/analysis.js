import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA_VERSION, iso, round, slug } from "./util.js";
import { PROMPT_VERSION, OUTPUT_SCHEMA, analysisTypeFor, buildPrompt, factOf } from "./prompt.js";
import { applyGuards, crossCompare } from "./guards.js";

export const MODEL = process.env.POLARIZED_MODEL || "claude-opus-5-5";

/** Cliente Claude se houver credencial no ambiente; senão null e o estágio é pulado. */
export function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic();
}

/** Uma chamada ao Claude com saída estruturada. Devolve o objeto ou lança com motivo legível. */
export async function askClaude(client, prompt) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error(`recusado (${res.stop_details?.category ?? "sem categoria"})`);
  if (res.stop_reason === "max_tokens") throw new Error("resposta cortada por max_tokens");
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  return { data: JSON.parse(text), model: res.model };
}

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

function factsFor(subject, all, sourceNames) {
  const measures = all.filter(e => e.kind === "measure");
  const related = all.filter(e => e.id !== subject.id && (e.kind === "condition" || e.kind === "event") &&
    ((subject.place.iso2 && e.place.iso2 === subject.place.iso2) || e.id === subject.parentId || e.parentId === subject.id))
    .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0)).slice(0, 5);
  return [subject, ...related].map(e => factOf(e, measures, sourceNames));
}

// No formato do modelo cada referência tem os dois campos (um deles null); na entidade, só o que existe.
const refs = list => (list || []).map(s => (s.entityId != null ? { entityId: s.entityId } : { precedent: s.precedent }));
const withRefs = list => (list || []).map(x => ({ ...x, supportedBy: refs(x.supportedBy) }));

/** Converte a saída aprovada pelas guardas em entidade do esquema. */
export function toAnalysisEntity({ subject, type, region, guarded, method, crossCheck, review, now, facts, all }) {
  const a = { ...guarded.analysis, points: withRefs(guarded.analysis.points), claims: withRefs(guarded.analysis.claims),
    counterpoint: { ...guarded.analysis.counterpoint, supportedBy: refs(guarded.analysis.counterpoint.supportedBy) } };
  const used = new Set(facts.map(f => f.entityId));
  const sources = [];
  for (const e of all) if (used.has(e.id)) for (const s of e.sources || []) if (!sources.some(x => x.sourceId === s.sourceId)) sources.push(s);
  const conf = Math.min(subject.confidence, 0.8) * (crossCheck ? crossCheck.agreement : 0.85);
  return {
    id: `plz:analysis:${slug(subject.id)}-${type}${region ? "-" + (region.iso2 || slug(region.name)).toLowerCase() : ""}`,
    schemaVersion: SCHEMA_VERSION, kind: "analysis", analysisType: type, subjectIds: [subject.id], layer: subject.layer,
    question: `${{ precedente: "Já foi tentado antes, e deu certo?", impacto: "O que isso muda, e para quem?", checagem: "O que foi dito confere?", contexto: "Como se chegou aqui?" }[type]}`,
    region: region || null,
    text: { pt: { headline: String(a.headline || subject.text.pt.headline).slice(0, 140), summary: String(a.summary || "").slice(0, 320) || "Análise sem resumo." } },
    points: a.points, precedents: a.precedents, conditions: a.conditions || [], impacts: a.impacts || [], claims: a.claims || [],
    counterpoint: a.counterpoint, limits: a.limits || "Sem limites declarados pelo modelo.",
    method: { ...method, promptVersion: PROMPT_VERSION, generatedAt: iso(now) },
    crossCheck: crossCheck || null,
    review: review || { status: "pendente", reviewer: null, at: null, note: null },
    guards: guarded.guards,
    status: review?.status === "aprovada" ? "verificado" : "nao_verificado",
    confidence: round(conf, 2),
    sources: sources.length ? sources : subject.sources,
    updatedAt: iso(now),
  };
}

/**
 * Estágio de análise. Escolhe os fatos de maior intensidade, reaproveita análises
 * anteriores do mesmo fato e da mesma versão de prompt, chama o modelo para o resto.
 */
export async function runAnalysis(entities, { now, policy, sources, prevAnalyses = [], reviews = {}, client, fixtures = null, log = () => {} }) {
  const P = policy.analysis;
  const sourceNames = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.shortName || v.name]));
  const subjects = entities
    .filter(e => (e.kind === "condition" || e.kind === "event") && P.layers.includes(e.layer) &&
      ((e.intensity ?? 0) >= P.minIntensity || (e.tags || []).includes("analisar")))
    .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0) || b.updatedAt.localeCompare(a.updatedAt));
  const prev = new Map(prevAnalyses.map(a => [`${a.subjectIds[0]}|${a.analysisType}`, a]));
  const out = [], report = { reused: 0, generated: 0, rejected: 0, failed: 0, skipped: 0 };
  let budget = P.maxPerRun;

  for (const subject of subjects) {
    const type = analysisTypeFor(subject);
    const old = prev.get(`${subject.id}|${type}`);
    if (old && old.method.promptVersion === PROMPT_VERSION && old.method.generatedAt >= subject.updatedAt) {
      const review = reviews[old.id];
      if (review?.status === "rejeitada") continue;
      out.push(review ? { ...old, review, status: review.status === "aprovada" ? "verificado" : old.status } : old);
      report.reused++;
      continue;
    }
    const fixture = fixtures?.[`${subject.id}|${type}`];
    if (!fixture && (!client || budget <= 0)) { report.skipped++; continue; }

    const facts = factsFor(subject, entities, sourceNames);
    const prompt = buildPrompt({ type, facts });
    try {
      let main, method;
      if (fixture) { main = { data: fixture.output }; method = fixture.method; }
      else {
        budget--;
        main = await askClaude(client, prompt);
        method = { provider: "anthropic", model: main.model || MODEL, effort: "high" };
      }
      const guarded = applyGuards(main.data, facts, type);
      if (guarded.rejected) {
        report.rejected++;
        log(`análise descartada (${subject.id}): ${guarded.guards.filter(g => !g.passed).map(g => g.detail).join("; ")}`);
        continue;
      }
      let crossCheck = null;
      const second = fixture ? null : await askCrossChecker(prompt).catch(e => (log(e.message), null));
      if (second) {
        const g2 = applyGuards(second.data, facts, type);
        crossCheck = { provider: "openai-compatible", model: second.model, ...crossCompare(guarded.analysis, g2.analysis) };
        guarded.guards.push({ rule: "conferencia_cruzada", passed: crossCheck.agreement >= P.crossCheckMinAgreement,
          detail: `concordância ${Math.round(crossCheck.agreement * 100)}% com ${second.model}` });
      }
      const entity = toAnalysisEntity({ subject, type, guarded, method, crossCheck, now, facts, all: entities,
        review: reviews[`plz:analysis:${slug(subject.id)}-${type}`] });
      if (entity.review.status === "rejeitada") continue;
      out.push(entity);
      report.generated++;
    } catch (e) {
      report.failed++;
      if (e instanceof Anthropic.RateLimitError) { log("limite de uso da API atingido; análises restantes ficam para a próxima execução"); break; }
      log(`análise falhou (${subject.id}): ${e.message}`);
    }
  }
  return { analyses: out, report };
}

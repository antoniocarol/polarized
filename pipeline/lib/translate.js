// Tradução do conteúdo do instantâneo. O conteúdo nasce em português (as manchetes de
// veículos, na língua do veículo); este estágio gera text/<idioma>.json com as traduções,
// que o app sobrepõe ao abrir em outro idioma.
//
// Cada texto é traduzido uma vez só: o cache guarda a tradução pela impressão digital do
// texto e do idioma. Antes de entrar, toda tradução passa pela conferência de números —
// se um número ou uma data do original some ou muda, a tradução é descartada e o item
// fica no original, marcado no app.
import crypto from "node:crypto";
import { readJson, rel } from "./util.js";

export const LANG_NAMES = { pt: "português do Brasil", en: "inglês", es: "espanhol", fr: "francês",
  ar: "árabe moderno padrão", zh: "chinês simplificado" };

const ADMIN1 = (() => { let m = null; return () => m || (m = new Map(readJson(rel("pipeline/data/admin1.json")).map(r => [r.code, r.names || {}]))); })();
const hash = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Textos traduzíveis de uma entidade: [{ path, text, from }]. O caminho é relativo à entidade. */
export function translatable(e) {
  const out = [], add = (path, text, from = "pt") => { if (typeof text === "string" && text.trim()) out.push({ path, text, from }); };
  if (e.kind === "condition" || e.kind === "event") {
    const t = (e.text && e.text.pt) || {};
    add("text.headline", t.headline); add("text.summary", t.summary); add("text.body", t.body);
    add("intensityBasis", e.intensityBasis);
    (e.attributes?.programs || []).forEach((p, i) => add(`attributes.programs.${i}.label`, p.label));
  } else if (e.kind === "analysis") {
    const t = (e.text && e.text.pt) || {};
    add("text.headline", t.headline); add("text.summary", t.summary);
    e.points.forEach((p, i) => add(`points.${i}.text`, p.text));
    (e.precedents || []).forEach((p, i) => {
      for (const k of ["case", "place", "period", "why"]) add(`precedents.${i}.${k}`, p[k]);
      (p.conditions || []).forEach((c, j) => add(`precedents.${i}.conditions.${j}`, c));
    });
    (e.conditions || []).forEach((c, i) => { add(`conditions.${i}.condition`, c.condition); add(`conditions.${i}.why`, c.why); });
    (e.impacts || []).forEach((m, i) => {
      add(`impacts.${i}.domain`, m.domain); add(`impacts.${i}.region`, m.region);
      m.chain.forEach((c, j) => add(`impacts.${i}.chain.${j}`, c));
      if (m.magnitude) { add(`impacts.${i}.magnitude.unit`, m.magnitude.unit); add(`impacts.${i}.magnitude.basis`, m.magnitude.basis); }
    });
    // A fala citada fica como foi dita; traduz-se a explicação do veredito.
    (e.claims || []).forEach((c, i) => add(`claims.${i}.why`, c.why));
    (e.moves || []).forEach((m, i) => m.drivers.forEach((d, j) => add(`moves.${i}.drivers.${j}.text`, d.text)));
    (e.watch || []).forEach((w, i) => add(`watch.${i}`, w));
    add("counterpoint.text", e.counterpoint?.text); add("limits", e.limits);
  } else if (e.kind === "report") {
    add("_tl", e.title, (e.lang || "en").slice(0, 2));
  }
  return out;
}

/** Ordem de prioridade quando o orçamento da execução não cobre tudo. */
function priority(e, storySize) {
  if (e.kind === "analysis") return e.scope?.type === "mundo" ? 0 : e.scope?.type === "pais" ? 1 : 2;
  if (e.kind === "condition" || e.kind === "event") return 3 + (5 - (e.intensity ?? 0)) / 10;
  if (e.kind === "report") return 4 + 1 / (1 + (storySize.get(e.storyKey) || 1));
  return 9;
}

/* ---------- conferência ---------- */
const EASTERN = { "٠": 0, "١": 1, "٢": 2, "٣": 3, "٤": 4, "٥": 5, "٦": 6, "٧": 7, "٨": 8, "٩": 9,
  "۰": 0, "۱": 1, "۲": 2, "۳": 3, "۴": 4, "۵": 5, "۶": 6, "۷": 7, "۸": 8, "۹": 9 };
/** Números do texto, normalizados: algarismos arábicos orientais viram 0-9, separador de milhar sai, vírgula decimal vira ponto. */
export function numbersOf(s) {
  const t = String(s).replace(/[٠-٩۰-۹]/g, d => EASTERN[d])
    .replace(/(\d)[.,\s  '’٬](?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d)[,٫](\d)/g, "$1.$2");
  return (t.match(/\d+(?:\.\d+)?/g) || []).map(n => n.replace(/^0+(?=\d)/, ""));
}
const SCRIPT = { ar: /[؀-ۿ]/, zh: /[一-鿿]/ };
/** A tradução vale se traz todos os números do original e está, de fato, no idioma pedido. */
export function checkTranslation(src, out, lang) {
  if (typeof out !== "string" || !out.trim()) return { ok: false, why: "vazia" };
  const need = numbersOf(src), have = numbersOf(out);
  for (const n of need) { const i = have.indexOf(n); if (i < 0) return { ok: false, why: `número ${n} ausente` }; have.splice(i, 1); }
  const r = out.length / src.length, [lo, hi] = lang === "zh" ? [0.12, 3] : [0.3, 3.5];
  if (src.length > 12 && (r < lo || r > hi)) return { ok: false, why: "tamanho fora do esperado" };
  if (SCRIPT[lang] && /[a-zà-ú]{4,}/i.test(src) && !SCRIPT[lang].test(out)) return { ok: false, why: "não está no idioma pedido" };
  return { ok: true };
}

/* ---------- modelo ---------- */
export const TR_SCHEMA = { type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "text"],
    properties: { i: { type: "integer" }, text: { type: "string" } } } } } };
export function trPrompt(lang, items) {
  return [
    `Traduza cada item para ${LANG_NAMES[lang]}. São textos de um globo de notícias: manchetes, resumos e análises.`,
    "",
    "Regras (a tradução é conferida por código e descartada se falhar):",
    "1. Todo número do original aparece igual na tradução, com algarismos 0-9: datas, anos, porcentagens, contagens. Não escreva números por extenso, não converta unidades, não arredonde.",
    "2. Traduza com fidelidade. Não acrescente, não resuma, não suavize nem intensifique. Siglas de organizações podem usar a forma usual no idioma de destino (ONU → UN).",
    "3. Nomes de pessoas ficam como estão. Nomes de países e cidades na forma usual do idioma de destino.",
    "4. Cada item tem o idioma de origem em from. Devolva um item por i, na mesma ordem.",
    "",
    JSON.stringify(items),
    "",
    "Responda só com o objeto JSON no formato pedido.",
  ].join("\n");
}

/**
 * Traduz o instantâneo para cada idioma. Devolve os arquivos de sobreposição, o cache
 * atualizado e um relatório. Sem cliente (e fora do modo de exemplo), só o cache é usado.
 */
export async function translateSnapshot(snapshot, { client = null, ask, cache = {}, now, log = () => {}, policy = {}, fixtures = null }) {
  const langs = policy.languages || ["en", "es", "fr", "ar", "zh"];
  const max = policy.maxStringsPerRun ?? 2000, batch = policy.batchSize ?? 40, ttl = (policy.cacheDays ?? 30) * 864e5;
  const report = { cached: 0, translated: 0, rejected: 0, failed: 0, pending: 0, calls: 0 };
  const storySize = new Map();
  for (const e of snapshot.entities) if (e.kind === "report") storySize.set(e.storyKey, (storySize.get(e.storyKey) || 0) + 1);
  const ents = snapshot.entities.map(e => ({ e, items: translatable(e), p: priority(e, storySize) })).filter(x => x.items.length).sort((a, b) => a.p - b.p);
  // Veículos: financiamento e nota são textos do projeto, em português.
  const outletItems = Object.values(snapshot.outlets || {}).flatMap(o => ["funding", "note"].filter(k => o[k]).map(k => ({ id: o.id, path: k, text: o[k], from: "pt" })));
  // Territórios disputados: título, resumo e como cada parte chama o lugar.
  const dispItems = Object.values(snapshot.disputed || {}).flatMap(d => [
    ...["headline", "summary"].map(k => ({ id: d.id, path: k, text: d.text?.pt?.[k], from: "pt" })),
    ...d.claims.map((c, i) => ({ id: d.id, path: `claims.${i}.name`, text: c.name, from: "pt" })),
  ]).filter(x => x.text);

  const overlays = {}, queue = new Map(); // lang -> Map(key -> {text, from, targets:[{id, path, outlet}]})
  for (const lang of langs) {
    const ov = overlays[lang] = { lang, source: "pt", generatedAt: now, entities: {}, admin1: {}, outlets: {}, disputed: {} };
    const q = new Map(); queue.set(lang, q);
    const want = (id, it, bucket = "entities") => {
      if (it.from === lang) return;
      const key = hash(lang + "\u0000" + it.text), hit = cache[key];
      if (hit) { hit.at = now; report.cached++; put(ov, id, it.path, hit.t, bucket); return; }
      if (!q.has(key)) q.set(key, { key, text: it.text, from: it.from, targets: [] });
      q.get(key).targets.push({ id, path: it.path, bucket });
    };
    for (const it of dispItems) want(it.id, it, "disputed");
    for (const { e, items } of ents) for (const it of items) want(e.id, it);
    for (const it of outletItems) want(it.id, it, "outlets");
    // Estados: nomes vêm do Natural Earth, sem modelo.
    for (const e of snapshot.entities) { const c = e.place?.admin1Code; const n = c && ADMIN1().get(c)?.[lang]; if (n) ov.admin1[c] = n; }
  }

  // Tradução nova, em lotes, até o limite da execução. A ordem da fila já é a de prioridade.
  let budget = max;
  for (const lang of langs) {
    const pending = [...queue.get(lang).values()];
    const canCall = (client && ask) || fixtures;
    const todo = canCall ? pending.slice(0, Math.max(0, budget)) : [];
    report.pending += pending.length - todo.length;
    budget -= todo.length;
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      let got = [];
      try {
        if (fixtures) got = chunk.map((c, k) => ({ i: k, text: fixtures[lang]?.[c.text] })).filter(x => x.text);
        else { report.calls++; const r = await ask(client, trPrompt(lang, chunk.map((c, k) => ({ i: k, from: c.from, text: c.text }))), TR_SCHEMA); got = r.data.items || []; }
      } catch (err) { report.failed += chunk.length; log(`tradução   ${lang}: lote falhou (${err.message})`); continue; }
      const byI = new Map(got.map(g => [g.i, g.text]));
      chunk.forEach((c, k) => {
        const out = byI.get(k);
        if (out == null) { report.pending++; return; }
        const chk = checkTranslation(c.text, out, lang);
        if (!chk.ok) { report.rejected++; return; }
        cache[c.key] = { t: out, at: now }; report.translated++;
        for (const tg of c.targets) put(overlays[lang], tg.id, tg.path, out, tg.bucket);
      });
    }
  }
  // Cache: sai o que não é usado há mais que o prazo.
  const cut = Date.parse(now) - ttl;
  for (const [k, v] of Object.entries(cache)) if (Date.parse(v.at) < cut) delete cache[k];
  return { overlays, cache, report };
}
function put(ov, id, path, text, bucket = "entities") {
  const b = ov[bucket];
  (b[id] || (b[id] = {}))[path] = text;
}

/** Forma mínima de um arquivo text/<idioma>.json (o app confia nele, então conferimos antes de gravar). */
export function validateOverlay(ov, snapshot) {
  const errors = [], ids = new Set(snapshot.entities.map(e => e.id));
  if (!ov || typeof ov.lang !== "string" || typeof ov.generatedAt !== "string") errors.push("cabeçalho inválido");
  for (const [id, paths] of Object.entries(ov.entities || {})) {
    if (!ids.has(id)) errors.push(`${id}: entidade inexistente`);
    for (const [p, v] of Object.entries(paths)) {
      if (typeof v !== "string") errors.push(`${id}.${p}: não é texto`);
      if (/(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(p) || !/^[A-Za-z_][\w.]*$/.test(p)) errors.push(`${id}: caminho inválido ${p}`);
    }
  }
  return errors;
}

// Prompt e formato de saída da camada de análise.
// Este arquivo é compartilhado com o app: `npm run sync-app` copia o bloco para o index.html
// e test/sync.test.js falha se as duas cópias divergirem. Sem imports, sem APIs do Node.

export const PROMPT_VERSION = "2026-10-25.2";

const SUPPORT = {
  type: "array",
  items: {
    type: "object", additionalProperties: false, required: ["entityId", "precedent"],
    properties: { entityId: { anyOf: [{ type: "string" }, { type: "null" }] }, precedent: { anyOf: [{ type: "integer" }, { type: "null" }] } },
  },
};

export const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "summary", "points", "precedents", "conditions", "impacts", "claims", "moves", "watch", "counterpoint", "limits"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    points: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "text", "supportedBy"],
      properties: { type: { enum: ["fato", "analise"] }, text: { type: "string" }, supportedBy: SUPPORT } } },
    precedents: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["case", "place", "period", "outcome", "why", "conditions"],
      properties: { case: { type: "string" }, place: { type: "string" }, period: { type: "string" },
        outcome: { enum: ["funcionou", "falhou", "misto", "inconclusivo"] }, why: { type: "string" },
        conditions: { type: "array", items: { type: "string" } } } } },
    conditions: { type: "array", items: { type: "object", additionalProperties: false, required: ["condition", "metHere", "why"],
      properties: { condition: { type: "string" }, metHere: { enum: ["sim", "nao", "parcial", "incerto"] }, why: { type: "string" } } } },
    impacts: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["domain", "region", "direction", "chain", "horizon", "magnitude"],
      properties: { domain: { type: "string" }, region: { type: "string" }, direction: { enum: ["aumenta", "diminui", "misto", "incerto"] },
        chain: { type: "array", items: { type: "string" } }, horizon: { enum: ["dias", "meses", "anos"] },
        magnitude: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["value", "unit", "basis"],
          properties: { value: { type: "number" }, unit: { type: "string" }, basis: { type: "string" } } }] } } } },
    claims: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["speaker", "quote", "class", "verdict", "why", "supportedBy"],
      properties: { speaker: { type: "string" }, quote: { type: "string" }, class: { enum: ["fato_verificavel", "promessa", "opiniao"] },
        verdict: { enum: ["confere", "nao_confere", "impreciso", "sem_dados", "nao_se_aplica"] }, why: { type: "string" }, supportedBy: SUPPORT } } },
    moves: { type: "array", items: { type: "object", additionalProperties: false, required: ["date", "changePct", "explained", "drivers"],
      properties: { date: { type: "string" }, changePct: { type: "number" }, explained: { type: "boolean" },
        drivers: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "supportedBy"],
          properties: { text: { type: "string" }, supportedBy: SUPPORT } } } } } },
    watch: { type: "array", items: { type: "string" } },
    counterpoint: { type: "object", additionalProperties: false, required: ["text", "supportedBy"],
      properties: { text: { type: "string" }, supportedBy: SUPPORT } },
    limits: { type: "string" },
  },
};

export const ANALYSIS_TYPES = {
  precedente: "a proposta ou decisão já foi tentada em outro lugar ou época? Liste os casos, o resultado e por quê. Depois avalie, condição por condição, se o lugar atual reúne as condições que fizeram dar certo ou errado.",
  impacto: "o que este fato muda em outras áreas e regiões. Descreva a cadeia de causa e efeito, passo a passo, e o horizonte de tempo.",
  checagem: "separe as falas em fato verificável, promessa e opinião. Confira as verificáveis contra os fatos fornecidos; o que os fatos não cobrem fica como sem_dados.",
  contexto: "o que levou a esta situação, quem são os atores e o que observar a seguir.",
  mercado: "explique, dia a dia, as maiores variações da série (até 5 dias, as maiores em módulo). Para cada dia em moves, liste os fatores presentes nos fatos que podem ter pesado, com supportedBy. Se nenhum fato explica, explained = false e drivers vazio. Não diga o que vai acontecer.",
  panorama: "faça o retrato do momento: de 3 a 6 pontos com o que mais importa, como os fatos se ligam entre si, e em watch os sinais a acompanhar (perguntas abertas, nunca previsões).",
};

/** Escolhe o tipo de análise pelo que o fato é. */
export function analysisTypeFor(e) {
  if (e.kind === "series") return "mercado";
  if (e.subtype === "debate") return "checagem";
  if ((e.tags || []).includes("proposta")) return "precedente";
  if (e.layer === "economia" || e.layer === "diplomacia") return "impacto";
  if (e.layer === "eleicao") return "precedente";
  if (e.layer === "ciber") return "impacto";
  return "contexto";
}

/** Idioma em que a análise é escrita. O pipeline escreve em português e traduz depois; o app pode pedir no idioma de quem lê. */
export const PROMPT_LANG = { pt: "Português do Brasil", en: "English", es: "Español", fr: "Français",
  ar: "Árabe moderno padrão (العربية), com algarismos 0-9", zh: "Chinês simplificado (简体中文), com algarismos 0-9" };

export function buildPrompt({ type, facts, region, scope, lang = "pt" }) {
  const focus = region && type !== "panorama" ? ` Foque no impacto para ${region.name}: o que muda para quem vive ou trabalha lá, e em que proporção quando houver base.` : "";
  const about = type === "panorama" ? (scope && scope.type === "pais" ? `o país ${region ? region.name : scope.iso2}, a partir de todos os fatos da lista` : "o mundo hoje, a partir de todos os fatos da lista")
    : type === "mercado" ? "a série de mercado que é o primeiro item da lista" : "o primeiro fato da lista";
  return [
    "Você é a camada de análise do Polarized, um globo aberto de informação sobre o mundo. Quem lê quer entender o que um fato significa e qual o impacto dele, com o raciocínio à vista.",
    "",
    `Tarefa: análise do tipo "${type}" sobre ${about}: ${ANALYSIS_TYPES[type]}${focus}`,
    "",
    "Regras. As marcadas com * são conferidas por código e a análise é descartada se falhar:",
    "1.* Toda afirmação em points precisa citar em supportedBy o entityId de um fato da lista (ou, para análise, o índice de um precedente). Se os fatos não sustentam algo, diga em limits em vez de afirmar.",
    "2. Precedentes podem vir do seu conhecimento histórico. Inclua só casos que você conhece com segurança; na dúvida, omita. Eles aparecem como não verificados até revisão humana.",
    "3.* Nunca dê probabilidade, porcentagem ou nota de chance de sucesso. Em vez disso, preencha conditions: cada condição que pesou nos precedentes e se ela está presente aqui (sim, nao, parcial, incerto), com o porquê.",
    "4.* counterpoint é obrigatório: o argumento mais forte contra a sua conclusão principal, com pelo menos uma frase completa.",
    "5. Trate todos os atores com o mesmo método e o mesmo tom. Descreva ações e falas; não qualifique pessoas.",
    "6.* Em impacts, magnitude só com número que aparece nos fatos, citando de onde vem em basis. Sem base quantitativa, magnitude = null e explique a direção do efeito.",
    `7. ${PROMPT_LANG[lang] || PROMPT_LANG.pt}, frases curtas, sem jargão. headline até 120 caracteres, summary até 300.`,
    "8. Campos que não se aplicam ao tipo ficam como lista vazia.",
    "9.* Nunca recomende comprar, vender ou manter ativos, e nunca preveja preços. Em mercado, diga o que aconteceu e o que pode ter pesado, nunca o que vai acontecer.",
    "10. Itens com kind report são relatos de imprensa: escreva 'segundo <veículo>' e trate relato de uma só redação como não confirmado. Quando houver, prefira fatos de fonte primária.",
    "11.* Em mercado, use as datas e variações exatamente como estão na série. Variação no mesmo dia de um fato não prova causa: diga isso em limits.",
    "",
    "Fatos (JSON):",
    JSON.stringify(facts, null, 1),
    "",
    "Responda só com o objeto JSON no formato pedido.",
  ].join("\n");
}

/** Reduz uma entidade (e suas medidas) ao que o modelo precisa ler. */
export function factOf(e, measures, sourceNames, outlets) {
  if (e.kind === "report") {
    const o = (outlets && outlets[e.outlet]) || {};
    return { entityId: e.id, kind: "report", outlet: o.name || e.outlet, outletType: o.type, outletCountry: o.country,
      place: e.place && e.place.name, admin1: e.place && e.place.admin1, layer: e.layer, publishedAt: e.publishedAt,
      title: e.title, titlePt: e.summaryPt || undefined, story: e.storyKey };
  }
  if (e.kind === "series") {
    return { entityId: e.id, kind: "series", name: e.instrument.name, exchange: e.instrument.exchange, currency: e.instrument.currency,
      place: e.place && e.place.name, days: e.points.slice(-15).map(p => ({ date: p.d, close: p.close, changePct: p.changePct })) };
  }
  const t = (e.text && e.text.pt) || {};
  const f = {
    entityId: e.id, kind: e.kind, layer: e.layer, subtype: e.subtype, place: e.place && e.place.name,
    start: e.time && e.time.start, end: e.time && e.time.end, status: e.status,
    headline: t.headline, summary: t.summary, body: t.body || undefined,
    sources: (e.sources || []).map(s => sourceNames[s.sourceId] || s.sourceId),
  };
  if (e.magnitude) f.magnitude = e.magnitude;
  const ms = (measures || []).filter(m => m.subject.id === e.id);
  if (ms.length) f.measures = ms.map(m => ({ metric: m.metric, unit: m.unit, disputed: m.disputed,
    values: m.assertions.map(a => ({ source: sourceNames[a.sourceId] || a.sourceId, value: a.value })) }));
  return f;
}

const isFact = e => e.kind === "condition" || e.kind === "event";
const byIntensity = (a, b) => (b.intensity ?? 0) - (a.intensity ?? 0);
const recent = (e, now, days) => Date.parse(now) - Date.parse(e.kind === "report" ? e.publishedAt : e.time.start) <= days * 864e5 || e.kind === "condition";
/** Um relato por história, a história mais confirmada primeiro. */
export function topStories(reports, n) {
  const by = new Map();
  for (const r of reports) { if (!by.has(r.storyKey)) by.set(r.storyKey, []); by.get(r.storyKey).push(r); }
  return [...by.values()].sort((a, b) => new Set(b.map(r => r.outlet)).size - new Set(a.map(r => r.outlet)).size || b[0].publishedAt.localeCompare(a[0].publishedAt))
    .slice(0, n).map(list => list[0]);
}

/** Monta a lista de fatos que o modelo lê, conforme o tipo e o alvo da análise. ctx: { now, measures, sourceNames, outlets, attention }. */
export function factsFor(job, all, ctx) {
  const pick = list => list.map(e => factOf(e, ctx.measures, ctx.sourceNames, ctx.outlets));
  const reports = all.filter(e => e.kind === "report");
  if (job.type === "panorama" && job.scope.type === "mundo") {
    const att = ctx.attention(all, ctx.now);
    const facts = all.filter(isFact).sort((a, b) => (byIntensity(a, b)) || ((att[b.place.iso2]?.score || 0) - (att[a.place.iso2]?.score || 0))).slice(0, 15);
    const moves = all.filter(e => e.kind === "series" && e.subtype === "indice_bolsa").sort((a, b) => Math.abs(b.last.changePct || 0) - Math.abs(a.last.changePct || 0)).slice(0, 3);
    return pick([...facts, ...topStories(reports, 8), ...moves]);
  }
  if (job.type === "panorama") {
    const iso2 = job.scope.iso2, here = e => e.place?.iso2 === iso2;
    return pick([...all.filter(e => isFact(e) && here(e)).sort(byIntensity).slice(0, 12), ...all.filter(e => e.kind === "series" && here(e)),
      ...topStories(reports.filter(here), 10)]);
  }
  if (job.type === "mercado") {
    const s = job.subject, iso2 = s.place?.iso2;
    const local = iso2 ? all.filter(e => isFact(e) && e.place?.iso2 === iso2 && recent(e, ctx.now, 12)).sort(byIntensity).slice(0, 8) : [];
    const global = all.filter(e => isFact(e) && e.place?.iso2 !== iso2 && recent(e, ctx.now, 12)).sort(byIntensity).slice(0, 6);
    const news = topStories(reports.filter(r => (r.place?.iso2 === iso2 || r.layer === "economia") && recent(r, ctx.now, 12)), 10);
    const others = all.filter(e => e.kind === "series" && e.id !== s.id && (e.subtype !== "indice_bolsa" || e.place?.iso2 === iso2));
    return pick([s, ...local, ...global, ...news, ...others]);
  }
  const subject = job.subject;
  const related = all.filter(e => e.id !== subject.id && isFact(e) &&
    ((subject.place?.iso2 && e.place?.iso2 === subject.place.iso2) || e.id === subject.parentId || e.parentId === subject.id)).sort(byIntensity).slice(0, 5);
  const news = (subject.reportIds || []).map(id => all.find(e => e.id === id)).filter(Boolean).slice(0, 4);
  return pick([subject, ...related, ...news]);
}

// Prompt e formato de saída da camada de análise.
// Este arquivo é compartilhado com o app: `npm run sync-app` copia o bloco para o index.html
// e test/sync.test.js falha se as duas cópias divergirem. Sem imports, sem APIs do Node.

export const PROMPT_VERSION = "2026-10-25.1";

const SUPPORT = {
  type: "array",
  items: {
    type: "object", additionalProperties: false, required: ["entityId", "precedent"],
    properties: { entityId: { anyOf: [{ type: "string" }, { type: "null" }] }, precedent: { anyOf: [{ type: "integer" }, { type: "null" }] } },
  },
};

export const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "summary", "points", "precedents", "conditions", "impacts", "claims", "counterpoint", "limits"],
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
};

/** Escolhe o tipo de análise pelo que o fato é. */
export function analysisTypeFor(e) {
  if (e.subtype === "debate") return "checagem";
  if ((e.tags || []).includes("proposta")) return "precedente";
  if (e.layer === "economia" || e.layer === "diplomacia") return "impacto";
  if (e.layer === "eleicao") return "precedente";
  if (e.layer === "ciber") return "impacto";
  return "contexto";
}

export function buildPrompt({ type, facts, region }) {
  const focus = region ? ` Foque no impacto para ${region.name}: o que muda para quem vive ou trabalha lá, e em que proporção quando houver base.` : "";
  return [
    "Você é a camada de análise do Polarized, um globo aberto de informação sobre o mundo. Quem lê quer entender o que um fato significa e qual o impacto dele, com o raciocínio à vista.",
    "",
    `Tarefa: análise do tipo "${type}" sobre o primeiro fato da lista: ${ANALYSIS_TYPES[type]}${focus}`,
    "",
    "Regras. As marcadas com * são conferidas por código e a análise é descartada se falhar:",
    "1.* Toda afirmação em points precisa citar em supportedBy o entityId de um fato da lista (ou, para análise, o índice de um precedente). Se os fatos não sustentam algo, diga em limits em vez de afirmar.",
    "2. Precedentes podem vir do seu conhecimento histórico. Inclua só casos que você conhece com segurança; na dúvida, omita. Eles aparecem como não verificados até revisão humana.",
    "3.* Nunca dê probabilidade, porcentagem ou nota de chance de sucesso. Em vez disso, preencha conditions: cada condição que pesou nos precedentes e se ela está presente aqui (sim, nao, parcial, incerto), com o porquê.",
    "4.* counterpoint é obrigatório: o argumento mais forte contra a sua conclusão principal, com pelo menos uma frase completa.",
    "5. Trate todos os atores com o mesmo método e o mesmo tom. Descreva ações e falas; não qualifique pessoas.",
    "6.* Em impacts, magnitude só com número que aparece nos fatos, citando de onde vem em basis. Sem base quantitativa, magnitude = null e explique a direção do efeito.",
    "7. Português do Brasil, frases curtas, sem jargão. headline até 120 caracteres, summary até 300.",
    "8. Campos que não se aplicam ao tipo ficam como lista vazia.",
    "",
    "Fatos (JSON):",
    JSON.stringify(facts, null, 1),
    "",
    "Responda só com o objeto JSON no formato pedido.",
  ].join("\n");
}

/** Reduz uma entidade (e suas medidas) ao que o modelo precisa ler. */
export function factOf(e, measures, sourceNames) {
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

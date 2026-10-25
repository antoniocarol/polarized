import test from "node:test";
import assert from "node:assert/strict";
import { applyGuards, crossCompare } from "../pipeline/lib/guards.js";

const facts = [{ entityId: "a:evt:1", summary: "Inflação de 7,8% em doze meses; 120 mil empregos." }];
const base = () => ({
  headline: "h", summary: "s", limits: "l",
  points: [{ type: "fato", text: "A inflação está em 7,8%.", supportedBy: [{ entityId: "a:evt:1", precedent: null }] }],
  precedents: [], conditions: [], claims: [],
  impacts: [{ domain: "emprego", region: "país", direction: "diminui", chain: ["x"], horizon: "meses", magnitude: null }],
  counterpoint: { text: "Um argumento contrário com frase completa.", supportedBy: [] },
});

test("aceita análise limpa", () => {
  const r = applyGuards(base(), facts, "impacto");
  assert.equal(r.rejected, false);
  assert.ok(r.guards.every(g => g.passed));
});

test("descarta estimativa de chance que não vem dos fatos", () => {
  const a = base(); a.conditions = [{ condition: "c", metHere: "sim", why: "por isso há 70% de chance de dar certo" }];
  const r = applyGuards(a, facts, "impacto");
  assert.equal(r.rejected, true);
  assert.equal(r.guards.find(g => g.rule === "sem_probabilidade").passed, false);
  const b = base(); b.summary = "Probabilidade de sucesso alta.";
  assert.equal(applyGuards(b, facts, "impacto").rejected, true);
});

test("porcentagem presente nos fatos é permitida", () => {
  const a = base(); a.summary = "Com inflação de 7,8%, o efeito é maior.";
  assert.equal(applyGuards(a, facts, "impacto").rejected, false);
});

test("referência a entidade inexistente cai, e ponto sem apoio sai", () => {
  const a = base();
  a.points.push({ type: "analise", text: "inventado", supportedBy: [{ entityId: "nao:existe:1", precedent: null }] });
  const r = applyGuards(a, facts, "impacto");
  assert.equal(r.analysis.points.length, 1);
  assert.equal(r.guards.find(g => g.rule === "apoio_em_fatos").passed, false);
  assert.equal(r.rejected, false);
});

test("fato só pode se apoiar em fato, não em precedente", () => {
  const a = base(); a.precedents = [{ case: "x", place: "y", period: "z", outcome: "falhou", why: "w", conditions: [] }];
  a.points = [{ type: "fato", text: "t", supportedBy: [{ entityId: null, precedent: 0 }] }];
  assert.equal(applyGuards(a, facts, "precedente").rejected, true);
});

test("sem contraponto, descarta", () => {
  const a = base(); a.counterpoint.text = "curto";
  assert.equal(applyGuards(a, facts, "impacto").rejected, true);
});

test("magnitude sem número nos fatos é removida; com número fica", () => {
  const a = base();
  a.impacts.push({ domain: "d", region: "r", direction: "aumenta", chain: ["x"], horizon: "anos", magnitude: { value: 999, unit: "u", basis: "b" } });
  a.impacts.push({ domain: "d", region: "r", direction: "aumenta", chain: ["x"], horizon: "anos", magnitude: { value: 120, unit: "mil empregos", basis: "fato" } });
  const r = applyGuards(a, facts, "impacto");
  assert.equal(r.analysis.impacts[1].magnitude, null);
  assert.equal(r.analysis.impacts[2].magnitude.value, 120);
});

test("checagem sem falas é descartada; veredito sem apoio é rebaixado", () => {
  assert.equal(applyGuards(base(), facts, "checagem").rejected, true);
  const a = base();
  a.claims = [{ speaker: "A", quote: "q", class: "fato_verificavel", verdict: "confere", why: "w", supportedBy: [] }];
  const r = applyGuards(a, facts, "checagem");
  assert.equal(r.analysis.claims[0].verdict, "sem_dados");
});

test("precedentes saem marcados como não verificados", () => {
  const a = base(); a.precedents = [{ case: "Plano X", place: "P", period: "1990", outcome: "misto", why: "w", conditions: [] }];
  const r = applyGuards(a, facts, "precedente");
  assert.equal(r.analysis.precedents[0].verified, false);
  assert.equal(r.analysis.precedents[0].origin, "conhecimento_do_modelo");
});

test("conferência cruzada mede concordância", () => {
  const a = { precedents: [{ case: "Plano Cruzado Brasil", outcome: "falhou" }], conditions: [{ condition: "saída planejada anunciada", metHere: "nao" }] };
  const same = crossCompare(a, structuredClone(a));
  assert.equal(same.agreement, 1);
  const b = structuredClone(a); b.conditions[0].metHere = "sim";
  const diff = crossCompare(a, b);
  assert.equal(diff.agreement, 0.5);
  assert.equal(diff.divergent.length, 1);
});

test("mercado: variação vem só da série analisada, nunca de outra série do mesmo dia", () => {
  const facts = [
    { entityId: "stooq:ser:a", kind: "series", days: [{ date: "2026-10-23", close: 1, changePct: -2.4 }] },
    { entityId: "stooq:ser:b", kind: "series", days: [{ date: "2026-10-23", close: 1, changePct: 3.1 }] },
  ];
  const a = { headline: "h", summary: "s", limits: "l", points: [{ type: "fato", text: "caiu", supportedBy: [{ entityId: "stooq:ser:a", precedent: null }] }],
    precedents: [], conditions: [], impacts: [], claims: [], watch: [],
    moves: [{ date: "2026-10-23", changePct: 9, explained: true, drivers: [{ text: "x", supportedBy: [{ entityId: "stooq:ser:b", precedent: null }] }] },
            { date: "2026-01-01", changePct: 1, explained: false, drivers: [] }],
    counterpoint: { text: "Um argumento contrário com frase completa.", supportedBy: [] } };
  const r = applyGuards(a, facts, "mercado");
  assert.equal(r.analysis.moves.length, 1, "dia fora da série sai");
  assert.equal(r.analysis.moves[0].changePct, -2.4, "variação corrigida para a da série analisada");
});

test("nunca recomenda compra ou venda; em mercado, nunca prevê preço", () => {
  const facts = [{ entityId: "stooq:ser:a", kind: "series", days: [{ date: "2026-10-23", close: 1, changePct: -2.4 }] }];
  const mk = summary => ({ headline: "h", summary, limits: "l", points: [{ type: "fato", text: "caiu", supportedBy: [{ entityId: "stooq:ser:a", precedent: null }] }],
    precedents: [], conditions: [], impacts: [], claims: [], watch: [], moves: [{ date: "2026-10-23", changePct: -2.4, explained: false, drivers: [] }],
    counterpoint: { text: "Um argumento contrário com frase completa.", supportedBy: [] } });
  assert.equal(applyGuards(mk("Recomendamos a compra de ações agora."), facts, "mercado").rejected, true);
  assert.equal(applyGuards(mk("O índice deve subir na semana que vem."), facts, "mercado").rejected, true);
  assert.equal(applyGuards(mk("A venda de petróleo caiu no trimestre."), facts, "mercado").rejected, false, "'venda' substantivo não é recomendação");
  assert.equal(applyGuards(mk("O custo deve subir para importadores."), facts, "contexto").rejected, false, "direção de efeito fora de mercado é permitida");
});

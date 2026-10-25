// Camadas de proteção da análise. Funções puras, compartilhadas com o app (npm run sync-app).
// Recebem a saída crua do modelo e os fatos; devolvem a análise corrigida, o relatório de
// cada regra e se a análise deve ser descartada.

const PROB = /(\d{1,3}(?:[.,]\d+)?\s?%)|\b(probabilidade|chances?)\s+(de|em)\s+(sucesso|dar certo|fracasso|\d)/i;

function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0];
    out.add(raw);
    out.add(raw.replace(/\./g, "").replace(",", "."));
    out.add(raw.replace(/,/g, ""));
  }
  return out;
}

export function applyGuards(raw, facts, analysisType) {
  const ids = new Set(facts.map(f => f.entityId));
  const factText = JSON.stringify(facts);
  const factNums = numbersIn(factText);
  const a = JSON.parse(JSON.stringify(raw));
  const guards = [];
  let rejected = false;

  // 1. Apoio em fatos: referências inexistentes caem; ponto sem apoio válido cai.
  const precedents = a.precedents || [];
  const okRef = (s, factOnly) => (s.entityId != null && ids.has(s.entityId)) || (!factOnly && s.precedent != null && s.precedent >= 0 && s.precedent < precedents.length);
  const clean = list => (list || []).map(s => ({ entityId: s.entityId ?? null, precedent: s.precedent ?? null }));
  let droppedRefs = 0, droppedPoints = 0;
  a.points = (a.points || []).map(p => {
    const sup = clean(p.supportedBy).filter(s => okRef(s, p.type === "fato"));
    droppedRefs += (p.supportedBy || []).length - sup.length;
    return { ...p, supportedBy: sup };
  }).filter(p => (p.supportedBy.length ? true : (droppedPoints++, false)));
  for (const c of a.claims || []) {
    const sup = clean(c.supportedBy).filter(s => okRef(s, true));
    droppedRefs += (c.supportedBy || []).length - sup.length;
    c.supportedBy = sup;
    if (c.class === "fato_verificavel" && (c.verdict === "confere" || c.verdict === "nao_confere") && !sup.length) {
      c.verdict = "sem_dados";
      c.why = `${c.why} (Veredito rebaixado: nenhum fato da lista sustenta a conferência.)`;
    }
  }
  if (a.counterpoint) a.counterpoint.supportedBy = clean(a.counterpoint.supportedBy).filter(s => okRef(s, false));
  const noPoints = a.points.length === 0;
  guards.push({ rule: "apoio_em_fatos", passed: droppedRefs === 0 && droppedPoints === 0 && !noPoints,
    detail: noPoints ? "nenhum ponto com apoio válido" : `${droppedRefs} referências inválidas removidas, ${droppedPoints} pontos sem apoio removidos` });
  if (noPoints) rejected = true;

  // 2. Sem probabilidade: porcentagem só se o número vier dos fatos.
  const texts = [a.headline, a.summary, a.limits, a.counterpoint && a.counterpoint.text,
    ...a.points.map(p => p.text), ...(a.conditions || []).flatMap(c => [c.condition, c.why]),
    ...(a.impacts || []).flatMap(i => [i.domain, ...i.chain]), ...precedents.map(p => p.why)];
  const hits = texts.filter(Boolean).flatMap(t => {
    const m = PROB.exec(t);
    if (!m) return [];
    const n = (m[1] || "").replace(/\s?%/, "");
    return n && factNums.has(n.replace(",", ".")) ? [] : [m[0]];
  });
  guards.push({ rule: "sem_probabilidade", passed: hits.length === 0,
    detail: hits.length ? `estimativa de chance encontrada: ${hits.slice(0, 3).join("; ")}` : "nenhuma estimativa de chance" });
  if (hits.length) rejected = true;

  // 3. Contraponto obrigatório.
  const cp = (a.counterpoint && a.counterpoint.text || "").trim();
  guards.push({ rule: "contraponto", passed: cp.length >= 20, detail: cp.length >= 20 ? "presente" : "ausente ou curto demais" });
  if (cp.length < 20) rejected = true;

  // 4. Magnitude com base nos fatos.
  let nulled = 0;
  for (const i of a.impacts || []) {
    if (i.magnitude && !factNums.has(String(i.magnitude.value))) { i.magnitude = null; nulled++; }
  }
  guards.push({ rule: "magnitude_com_base", passed: nulled === 0,
    detail: nulled ? `${nulled} magnitudes sem número correspondente nos fatos foram removidas` : "magnitudes conferidas" });

  // 5. Conteúdo mínimo por tipo.
  const need = { checagem: (a.claims || []).length, impacto: (a.impacts || []).length, precedente: precedents.length || (a.limits ? 1 : 0), contexto: 1 }[analysisType];
  guards.push({ rule: "conteudo_do_tipo", passed: need > 0, detail: need > 0 ? "ok" : `análise de ${analysisType} sem o conteúdo do tipo` });
  if (!need) rejected = true;

  // 6. Precedentes do modelo sempre entram como não verificados.
  a.precedents = precedents.map(p => ({ ...p, origin: "conhecimento_do_modelo", sourceUrl: null, verified: false }));
  guards.push({ rule: "precedentes_marcados", passed: true,
    detail: a.precedents.length ? `${a.precedents.length} precedentes aguardam verificação humana` : "sem precedentes" });

  return { analysis: a, guards, rejected };
}

const words = s => new Set(String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 3));
function sim(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
function pairUp(xs, ys, key, same) {
  if (!xs.length && !ys.length) return null;
  let agree = 0; const div = [];
  for (const x of xs) {
    let best = null, bs = 0;
    for (const y of ys) { const s = sim(key(x), key(y)); if (s > bs) { bs = s; best = y; } }
    if (best && bs >= 0.3 && same(x, best)) agree++;
    else div.push(key(x));
  }
  return { score: agree / Math.max(xs.length, ys.length), div };
}

/** Compara duas análises do mesmo fato feitas por modelos diferentes. */
export function crossCompare(a, b) {
  const parts = {
    precedentes: pairUp(a.precedents || [], b.precedents || [], p => p.case, (x, y) => x.outcome === y.outcome),
    condicoes: pairUp(a.conditions || [], b.conditions || [], c => c.condition, (x, y) => x.metHere === y.metHere),
    falas: pairUp(a.claims || [], b.claims || [], c => c.quote, (x, y) => x.verdict === y.verdict),
    impactos: pairUp(a.impacts || [], b.impacts || [], i => `${i.domain} ${i.region}`, (x, y) => x.direction === y.direction),
  };
  const used = Object.entries(parts).filter(([, v]) => v);
  const agreement = used.length ? used.reduce((s, [, v]) => s + v.score, 0) / used.length : 1;
  const divergent = used.flatMap(([k, v]) => v.div.map(d => `${k}: ${d}`)).slice(0, 12);
  return { agreement: Math.round(agreement * 100) / 100, divergent };
}

// Índice de atenção por país. Compartilhado com o app (npm run sync-app): a fórmula
// que o pipeline usa para escolher panoramas é a mesma que o app mostra. Sem imports.

export const ATTENTION_WEIGHTS = { conflito: 1, sismico: 0.8, clima: 0.8, protesto: 0.7, ciber: 0.6, diplomacia: 0.5, eleicao: 0.5, economia: 0.5, militar: 0.3 };
export const ATTENTION_FORMULA = "Para cada país e camada: o fato mais grave conta inteiro e os demais acrescentam com retorno decrescente (metade da raiz quadrada da soma), para que gravidade pese mais que volume. Cada fato vale a intensidade vezes o peso da camada (conflito 1; sismos e clima 0,8; protestos 0,7; ciber 0,6; diplomacia, eleição e economia 0,5; militar 0,3), e eventos perdem metade do peso a cada 33 horas. Notícias somam 0,15 cada, até 3 pontos; variação forte na bolsa, até 1. O índice vai de 0 a 100 em relação ao país com mais atenção agora.";

export function attentionByCountry(entities, nowIso) {
  const now = Date.parse(nowIso), raw = {};
  for (const e of entities) {
    const iso2 = e.place && e.place.iso2;
    if (!iso2) continue;
    const w = ATTENTION_WEIGHTS[e.layer] || 0.5;
    let pts = 0, key = e.layer;
    if (e.kind === "condition") pts = (e.intensity == null ? 1 : e.intensity) * w;
    else if (e.kind === "event") { const age = Math.max(0, (now - Date.parse(e.time.start)) / 36e5); pts = (e.intensity == null ? 1 : e.intensity) * w * Math.exp(-age / 48); }
    else if (e.kind === "report") { pts = 0.15; key = "noticias"; }
    else if (e.kind === "series" && e.subtype === "indice_bolsa") pts = Math.min(1, Math.abs(e.last.changePct || 0) / 3);
    else continue;
    const c = raw[iso2] || (raw[iso2] = { iso2, layers: {}, reports: 0, items: 0 });
    c.items++;
    if (key === "noticias") c.reports++;
    (c.layers[key] || (c.layers[key] = [])).push(pts);
  }
  const by = {};
  for (const c of Object.values(raw)) {
    const byLayer = {};
    for (const [k, list] of Object.entries(c.layers)) {
      if (k === "noticias") { byLayer[k] = Math.min(3, list.length * 0.15); continue; }
      list.sort((a, b) => b - a);
      byLayer[k] = list[0] + 0.5 * Math.sqrt(list.slice(1).reduce((s, v) => s + v, 0));
    }
    by[c.iso2] = { iso2: c.iso2, byLayer, reports: c.reports, items: c.items, score: Object.values(byLayer).reduce((s, v) => s + v, 0) };
  }
  const list = Object.values(by), max = Math.max(1e-9, ...list.map(c => c.score));
  for (const c of list) c.index = Math.round((100 * c.score) / max);
  return by;
}

// Listas de sanções: OFAC (EUA), Conselho de Segurança da ONU e União Europeia.
// Cada lista vira uma condição "regime de sanções" por país-alvo, com a contagem de
// designações como medida. As três se juntam no mesmo cartão (clusterKey sancoes:XX),
// com cada emissor como uma fonte.
import { http, readJson, rel } from "../lib/util.js";
import { country } from "../lib/geo.js";
import { countryCondition } from "../lib/aggregate.js";

const MAP = readJson(rel("pipeline/data/sanction-programs.json"));
const scale = n => (n >= 1000 ? 5 : n >= 100 ? 4 : n >= 10 ? 3 : 2);

/** Linha do SDN.CSV (sem cabeçalho; campos entre aspas; "-0-" = vazio). */
export function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(v => (v.trim() === "-0-" ? "" : v.trim()));
}

function conditions(sourceId, counts, ctx, issuer, url, from) {
  const out = [];
  for (const [iso2, { n, programs }] of counts) {
    const progs = [...programs].sort().slice(0, 8).join(", ");
    out.push(...countryCondition({
      sourceId, iso2, layer: "diplomacia", subtype: "regime_sancoes", id: `${sourceId}:cond:${iso2.toLowerCase()}-sancoes`,
      start: ctx.now, now: ctx.now, startKnown: false, intensity: scale(n),
      basis: "designações vigentes na lista: menos de 10 → 2, 10 a 99 → 3, 100 a 999 → 4, mil ou mais → 5",
      status: "verificado", confidence: 0.95,
      headline: c => `Sob sanções — ${c.pt}`,
      summary: c => `${issuer} mantém ${n === 1 ? "1 designação" : n + " designações"} ligadas a ${c.pt}${progs ? ` (programas: ${progs})` : ""}.`.slice(0, 320),
      url, clusterKey: `sancoes:${iso2}`,
      metric: `designacoes_${sourceId}`, unit: "designações", value: n,
    }));
    const cond = out.findLast(e => e.kind === "condition");
    if (cond) cond.relations = [{ type: "sanciona", from, to: iso2, label: issuer }];
  }
  return out;
}
function bump(counts, iso2, program) {
  const a = counts.get(iso2) || { n: 0, programs: new Set() };
  a.n++; a.programs.add(program); counts.set(iso2, a);
}

export const ofac = {
  id: "ofac",
  fixture: "ofac.csv",
  async fetch(ctx) { return (await http(ctx.source.endpoint, { timeoutMs: 90000 })).text(); },
  normalize(raw, ctx) {
    const counts = new Map(), unknown = new Set();
    for (const line of String(raw).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const f = parseCsvLine(line);
      const programs = (f[3] || "").replace(/^\[|\]$/g, "").split(/\]\s*\[/).map(s => s.trim()).filter(Boolean);
      const hit = new Set();
      for (const p of programs) { const iso2 = MAP.ofac[p]; if (iso2) hit.add(iso2 + "|" + p); else unknown.add(p); }
      const seen = new Set();
      for (const h of hit) { const [iso2, p] = h.split("|"); if (!seen.has(iso2)) { bump(counts, iso2, p); seen.add(iso2); } else counts.get(iso2).programs.add(p); }
    }
    return { entities: conditions("ofac", counts, ctx, "O Tesouro dos EUA (OFAC)", "https://sanctionssearch.ofac.treas.gov/", "US") };
  },
};

export const unsc = {
  id: "un_sc",
  fixture: "un_sc.xml",
  async fetch(ctx) { return (await http(ctx.source.endpoint, { timeoutMs: 90000 })).text(); },
  normalize(raw, ctx) {
    const counts = new Map();
    for (const m of String(raw).matchAll(/<(INDIVIDUAL|ENTITY)>([\s\S]*?)<\/\1>/g)) {
      const list = /<UN_LIST_TYPE>\s*([^<]+?)\s*<\/UN_LIST_TYPE>/.exec(m[2])?.[1];
      const iso2 = list && MAP.un[list];
      if (iso2) bump(counts, iso2, list);
    }
    return { entities: conditions("un_sc", counts, ctx, "O Conselho de Segurança da ONU", "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", "UN") };
  },
};

export const eu = {
  id: "eu_sanctions",
  fixture: "eu_sanctions.xml",
  needs: ["EU_FSF_TOKEN"],
  async fetch(ctx) { return (await http(`${ctx.source.endpoint}?token=${encodeURIComponent(process.env.EU_FSF_TOKEN)}`, { timeoutMs: 120000 })).text(); },
  normalize(raw, ctx) {
    const counts = new Map();
    for (const m of String(raw).matchAll(/<sanctionEntity\b[\s\S]*?<\/sanctionEntity>/g)) {
      const prog = /<regulation\b[^>]*\bprogramme="([^"]+)"/.exec(m[0])?.[1];
      if (!prog || MAP.euIgnore.includes(prog)) continue;
      const c = country(prog.slice(0, 3));
      if (c) bump(counts, c.iso2, prog);
    }
    return { entities: conditions("eu_sanctions", counts, ctx, "A União Europeia", "https://www.sanctionsmap.eu/", "EU") };
  },
};

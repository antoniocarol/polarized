import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rel, readJson } from "../pipeline/lib/util.js";
import { UI_LANGS } from "../scripts/sync-app.js";
import { numbersOf, checkTranslation, translatable, translateSnapshot, validateOverlay } from "../pipeline/lib/translate.js";
import { applyGuards } from "../pipeline/lib/guards.js";
import { countryAt, disputedAt } from "../pipeline/lib/geo.js";

const pt = readJson(rel("i18n/ui/pt.json"));
const html = fs.readFileSync(rel("index.html"), "utf8");

test("todo idioma da interface tem todas as chaves do português, com as mesmas variáveis", () => {
  const vars = v => [...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  for (const l of UI_LANGS) {
    const d = readJson(rel(`i18n/ui/${l}.json`));
    assert.deepEqual(Object.keys(d).sort(), Object.keys(pt).sort(), `${l}: chaves diferentes`);
    for (const k of Object.keys(pt)) {
      const a = pt[k], b = d[k];
      assert.equal(typeof b === "object", typeof a === "object", `${l}.${k}: plural`);
      if (typeof b === "object") assert.ok(b.other, `${l}.${k}: sem forma other`);
      // As variáveis do português precisam existir na tradução (formas sem {n} no árabe "one"/"two" são permitidas).
      const need = new Set(vars(a).split(",").filter(Boolean)), have = new Set(vars(b).split(",").filter(Boolean));
      for (const v of need) if (v !== "n") assert.ok(have.has(v), `${l}.${k}: falta {${v}}`);
    }
  }
});

test("as chaves usadas no app existem no dicionário, e os rótulos da taxonomia batem com o taxonomy.json", () => {
  const used = new Set([...html.matchAll(/\bt\("([a-z][a-z_0-9]*\.[a-z_.0-9]*[a-z0-9_])"/g)].map(m => m[1]));
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) used.add(pair.split(":")[1]);
  for (const k of used) assert.ok(k in pt, `chave ausente: ${k}`);
  const tax = readJson(rel("schema/taxonomy.json"));
  for (const [k, L] of Object.entries(tax.layers)) {
    assert.equal(pt[`layer.${k}`], L.label);
    for (const [s, v] of Object.entries(L.subtypes)) assert.equal(pt[`sub.${k}.${s}`], v.label);
  }
});

test("conferência da tradução: números iguais, idioma certo", () => {
  assert.deepEqual(numbersOf("1.200 mortos em 25 de out. de 2026; 3,7 milhões"), ["1200", "25", "2026", "3.7"]);
  assert.deepEqual(numbersOf("١٢ قتيلًا"), ["12"]);
  assert.ok(checkTranslation("Magnitude 6,1 a 34 km", "Magnitude 6.1 at 34 km", "en").ok);
  assert.ok(checkTranslation("1.200 mortos", "1,200 dead", "en").ok);
  assert.equal(checkTranslation("1.200 mortos", "1,300 dead", "en").ok, false);
  assert.equal(checkTranslation("405 designações em 2026", "405 designations", "en").ok, false);
  assert.equal(checkTranslation("Guerra em curso no leste", "Guerra em curso no leste", "zh").ok, false);
  assert.ok(checkTranslation("Guerra em curso no leste", "东部持续的战争", "zh").ok);
});

test("tradução: cache, prioridade, descarte do que falha e arquivo válido", async () => {
  const snap = readJson(rel("data/snapshot.example.json"));
  const W = snap.entities.find(e => e.kind === "analysis" && e.scope?.type === "mundo");
  assert.ok(translatable(W).some(x => x.path === "points.0.text"));
  assert.ok(translatable(snap.entities.find(e => e.kind === "report")).every(x => x.path === "_tl"));
  const calls = [];
  // Modelo de mentira: traduz para "EN: ...", mas erra o número de todo item que tem número.
  const ask = async (client, prompt) => {
    const items = JSON.parse(prompt.split("\n").find(l => l.startsWith("[{")));
    calls.push(items.length);
    return { data: { items: items.map(it => ({ i: it.i, text: /\d/.test(it.text) ? it.text.replace(/\d+/, m => String(+m + 1)) : "EN: " + it.text })) } };
  };
  const cache = {};
  const r1 = await translateSnapshot(snap, { client: {}, ask, cache, now: snap.generatedAt, policy: { languages: ["en"], maxStringsPerRun: 50, batchSize: 20 } });
  assert.equal(calls.reduce((a, b) => a + b, 0), 50, "respeita o limite por execução");
  assert.ok(r1.report.rejected >= 1, "número trocado é descartado");
  const ov = r1.overlays.en;
  assert.ok(ov.entities[W.id]["text.headline"].startsWith("EN: "), "o resumo do mundo vem primeiro");
  assert.deepEqual(validateOverlay(ov, snap), []);
  const before = calls.length;
  const r2 = await translateSnapshot(snap, { client: {}, ask, cache, now: snap.generatedAt, policy: { languages: ["en"], maxStringsPerRun: 0 } });
  assert.equal(calls.length, before, "sem orçamento, nada novo é pedido");
  assert.ok(r2.report.cached >= r1.report.translated, "o que já foi traduzido sai do cache");
  assert.ok(validateOverlay({ lang: "en", generatedAt: "x", entities: { [W.id]: { "__proto__.x": "y" } } }, snap).length);
});

test("territórios disputados: visão da ONU e marcação", () => {
  assert.equal(countryAt(45.0, 34.1).iso2, "UA", "Crimeia fica com a Ucrânia, marcada como disputada");
  assert.equal(countryAt(55.75, 37.62).iso2, "RU");
  assert.equal(countryAt(42.6, 20.9).iso2, "XK");
  assert.equal(disputedAt({ iso2: "UA", admin1Code: "UA-43" }, 45, 34.1), "crimeia");
  assert.equal(disputedAt({ iso2: "TW" }, 25, 121.5), "taiwan");
  assert.equal(disputedAt({ iso2: null }, 10, 114), "spratly");
  assert.equal(disputedAt({ iso2: "UA" }, null, null), null, "o país inteiro não é disputado");
  const snap = readJson(rel("data/snapshot.example.json"));
  assert.ok(snap.disputed && Object.keys(snap.disputed).length, "o exemplo cita ao menos uma área");
  for (const d of Object.values(snap.disputed)) assert.ok(d.claims.length >= 2 && d.text.pt.summary);
});

test("camadas de proteção valem em todos os idiomas da análise", () => {
  const facts = [{ entityId: "a", kind: "series", days: [{ date: "2026-10-23", changePct: -2.4 }] }];
  const base = { headline: "x", summary: "", points: [{ type: "fato", text: "", supportedBy: [{ entityId: "a" }] }], precedents: [], conditions: [], impacts: [], claims: [],
    moves: [{ date: "2026-10-23", changePct: -2.4, explained: false, drivers: [] }], watch: [], counterpoint: { text: "Outro fator pode ter pesado mais.", supportedBy: [] }, limits: "" };
  const run = text => applyGuards({ ...base, points: [{ ...base.points[0], text }] }, facts, "mercado");
  for (const bad of ["We recommend buying now.", "Recomendamos comprar.", "Nous conseillons d'acheter.", "ننصح بالشراء الآن.", "建议买入。",
    "The index will rise next week.", "El índice va a subir.", "L'indice va monter.", "سيرتفع المؤشر.", "指数将继续上涨。"]) {
    assert.equal(run(bad).rejected, true, `não barrou: ${bad}`);
  }
  assert.equal(run("The index fell 2.4% on the day oil rose.").rejected, false);
});

test("classificação por palavras-chave entende manchetes em outras línguas", async () => {
  const { keywordClassify: k } = await import("../pipeline/lib/classify.js");
  const cases = [
    ["Ataque con drones contra Járkov daña infraestructura energética", "UA", "conflito"],
    ["Un séisme frappe la côte est du Japon", "JP", "sismico"],
    ["زلزال قوي يضرب اليابان", "JP", "sismico"],
    ["هجوم بطائرات مسيّرة على خاركيف", "UA", "conflito"],
    ["日本东部海域发生强烈地震", "JP", "sismico"],
    ["伊朗断网进入第二天", "IR", "ciber"],
  ];
  for (const [t, iso2, layer] of cases) { const r = k(t); assert.equal(r.iso2, iso2, t); assert.equal(r.layer, layer, t); }
  assert.equal(k("West Africa summit ends without a deal").iso2, null, "'west' sozinho não é Cisjordânia");
  assert.equal(k("White smoke as cardinals meet").iso2, null, "'white' sozinho não é Casa Branca");
});

test("o app liga as abas, a busca, os botões do globo e o seletor de idioma", () => {
  for (const hook of ['getElementById("tabs").addEventListener("click"', 'qEl.addEventListener("input"', "heatBtn.onclick", "linkBtn.onclick", 'getElementById("langs")', 'detail.addEventListener("click"'])
    assert.ok(html.includes(hook), `falta: ${hook}`);
});

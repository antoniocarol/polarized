import test from "node:test";
import assert from "node:assert/strict";
import { NOW, ctx, fixture } from "./helpers.js";
import { readJson, rel } from "../pipeline/lib/util.js";
import { validateEntity } from "../pipeline/lib/validate.js";
import { parseFeed, decode } from "../pipeline/lib/feeds.js";
import { rss, bluesky, x } from "../pipeline/adapters/news.js";
import markets, { parseDaily } from "../pipeline/adapters/markets.js";
import { keywordClassify, classifyReports } from "../pipeline/lib/classify.js";
import { clusterStories, attachReports } from "../pipeline/lib/stories.js";
import { attentionByCountry } from "../pipeline/lib/attention.js";
import { enrichAdmin1 } from "../pipeline/lib/enrich.js";
import { admin1At } from "../pipeline/lib/geo.js";

const outlets = readJson(rel("pipeline/fixtures/outlets.json")).outlets;
const nctx = id => ({ ...ctx(id), outlets });

test("feeds: RSS, RDF e Atom, com CDATA, entidades e HTML removido", () => {
  const items = parseFeed(`<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://a.invalid/1</link>
    <pubDate>Sun, 25 Oct 2026 10:00:00 +0000</pubDate><description>&lt;p&gt;Oi&lt;/p&gt; &#233;</description></item></channel></rss>
    <feed><entry><title>Atom</title><link rel="alternate" href="https://a.invalid/2"/><updated>2026-10-25T10:00:00Z</updated><summary>S</summary></entry></feed>`);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "A & B");
  assert.equal(items[0].description, "Oi é");
  assert.equal(items[1].link, "https://a.invalid/2");
  assert.equal(decode("<b>x</b>&nbsp;y"), "x y");
});

test("RSS, Bluesky e X viram relatos válidos; fora da janela e repost ficam de fora", () => {
  const r = rss.normalize(fixture("rss.json"), nctx("rss")).entities;
  assert.equal(r.length, 21);
  assert.ok(!r.some(e => /antiga/.test(e.title)));
  const b = bluesky.normalize(fixture("bluesky.json"), nctx("bluesky")).entities;
  assert.equal(b.length, 1);
  assert.equal(b[0].url, "https://exemplo.invalid/bsky/japan-quake", "usa o link da matéria, não o post");
  const t = x.normalize(fixture("x.json"), nctx("x")).entities;
  assert.equal(t[0].url, "https://exemplo.invalid/x/kharkiv");
  assert.doesNotMatch(t[0].title, /t\.co/);
  for (const e of [...r, ...b, ...t]) assert.ok(validateEntity(e), JSON.stringify(validateEntity.errors?.slice(0, 2)));
});

test("classificação por palavras-chave: lugar citado vence gentílico; estado identificado", () => {
  assert.equal(keywordClassify("Russian drone strike hits Kharkiv apartment block").iso2, "UA");
  const rs = keywordClassify("Chuvas fortes atingem o Rio Grande do Sul");
  assert.deepEqual([rs.iso2, rs.admin1Code, rs.layer], ["BR", "BR-RS", "clima"]);
  assert.equal(keywordClassify("Ibovespa fecha em queda").subtype, "indice_bolsa");
});

test("classificação pelo modelo: resposta conferida campo a campo e guardada em cache", async () => {
  const reps = rss.normalize(fixture("rss.json"), nctx("rss")).entities.slice(0, 3);
  let calls = 0;
  const ask = async () => { calls++; return { data: { items: [
    { i: 0, iso2: "jp", admin1: null, layer: "sismico", subtype: "terremoto", topic: "Japan east coast earthquake", summaryPt: "Terremoto no Japão" },
    { i: 1, iso2: "XX", admin1: null, layer: "inexistente", subtype: "x", topic: "t", summaryPt: "s" },
    { i: 2, iso2: "BR", admin1: "Rio Grande do Sul", layer: "economia", subtype: "nao_existe", topic: "t", summaryPt: "s" } ] } }; };
  const { cache } = await classifyReports(reps, { client: {}, ask, now: NOW });
  assert.equal(reps[0].place.iso2, "JP");
  assert.equal(reps[0].classifiedBy, "modelo");
  assert.equal(reps[1].place, null, "país inválido é descartado");
  assert.equal(reps[1].layer, null);
  assert.equal(reps[2].place.admin1Code, "BR-RS");
  assert.equal(reps[2].subtype, null, "subtipo fora da taxonomia é descartado");
  const again = rss.normalize(fixture("rss.json"), nctx("rss")).entities.slice(0, 3);
  await classifyReports(again, { client: {}, ask, cache, now: NOW });
  assert.equal(calls, 1, "relatos já classificados não voltam ao modelo");
});

test("histórias: mesma notícia em várias redações vira uma história; relatos se ligam aos fatos", () => {
  const reps = [...rss.normalize(fixture("rss.json"), nctx("rss")).entities, ...bluesky.normalize(fixture("bluesky.json"), nctx("bluesky")).entities];
  for (const r of reps) { const k = keywordClassify(`${r.title} ${r.excerpt || ""}`); r.place = k.iso2 ? { iso2: k.iso2, iso3: null, name: k.iso2 } : null; r.layer = k.layer; }
  clusterStories(reps);
  const jp = reps.filter(r => r.place?.iso2 === "JP" && r.lang === "en");
  assert.ok(jp.length >= 3);
  assert.equal(new Set(jp.map(r => r.storyKey)).size, 1);
  const kh = reps.filter(r => /Kharkiv/.test(r.title));
  assert.equal(new Set(kh.map(r => r.storyKey)).size, 1);
  const ua = { id: "x:cond:ua", kind: "condition", layer: "conflito", place: { iso2: "UA" }, intensity: 5, time: { start: NOW } };
  attachReports(reps, [ua]);
  assert.ok(ua.reportIds.length >= 3);
  assert.ok(kh.every(r => r.relatedIds.includes("x:cond:ua")));
});

test("mercados: CSV diário vira série com variação diária; símbolo com falha fica no aviso", () => {
  assert.deepEqual(parseDaily("Date,Open,High,Low,Close,Volume\n2026-10-22,1,1,1,10,0\n2026-10-23,1,1,1,11,0\n").map(r => r.close), [10, 11]);
  const res = markets.normalize(fixture("stooq.json"), ctx("stooq"));
  const bvp = res.entities.find(e => e.id === "stooq:ser:^bvp");
  assert.equal(bvp.last.d, "2026-10-23");
  assert.equal(bvp.last.changePct, -2.4);
  assert.equal(bvp.place.iso2, "BR");
  assert.ok(bvp.geo, "índice tem ponto na cidade da bolsa");
  assert.equal(res.entities.find(e => e.id === "stooq:ser:cb.f").geo, null);
  assert.equal(res.warnings.length, 1);
  for (const e of res.entities) assert.ok(validateEntity(e), JSON.stringify(validateEntity.errors?.slice(0, 2)));
});

test("atenção: gravidade pesa mais que volume", () => {
  const ev = (iso2, layer, intensity) => ({ kind: "event", layer, intensity, place: { iso2 }, time: { start: NOW } });
  const many = Array.from({ length: 20 }, () => ev("FR", "protesto", 2));
  const one = { kind: "condition", layer: "conflito", intensity: 5, place: { iso2: "UA" } };
  const a = attentionByCountry([...many, one], NOW);
  assert.ok(a.UA.score > a.FR.score);
  assert.equal(a.UA.index, 100);
});

test("estado: eventos com ponto ganham o estado do Natural Earth", () => {
  const e = { kind: "event", geo: { type: "Point", coordinates: [-46.63, -23.55] }, place: { iso2: "BR", name: "Brasil" } };
  enrichAdmin1([e]);
  assert.equal(e.place.admin1Code, "BR-SP");
  assert.equal(admin1At(52.52, 13.40, "DE").code, "DE-BE", "Berlim, dentro de Brandemburgo");
});

test("notícias: a mesma matéria repetida no feed vira um relato só", async () => {
  const { rss } = await import("../pipeline/adapters/news.js");
  const item = '<item><title>Same story</title><link>https://example.org/a</link><pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate></item>';
  const xml = `<rss><channel>${item}${item}</channel></rss>`;
  const outlets = [{ id: "o1", name: "O1", lang: "en", feeds: [{ kind: "rss", url: "x" }] }, { id: "o2", name: "O2", lang: "en", feeds: [{ kind: "rss", url: "y" }] }];
  const r = rss.normalize({ raw: { o1: xml, o2: xml } }, { outlets, now: "2026-10-25T12:00:00Z" });
  assert.equal(r.entities.length, 1);
});

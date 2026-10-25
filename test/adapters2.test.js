import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NOW, ctx, fixture } from "./helpers.js";
import { rel } from "../pipeline/lib/util.js";
import { validateEntity } from "../pipeline/lib/validate.js";
import { clusterEntities } from "../pipeline/lib/cluster.js";
import ucdp from "../pipeline/adapters/ucdp.js";
import acled, { mapAcled } from "../pipeline/adapters/acled.js";
import { ofac, unsc, eu, parseCsvLine } from "../pipeline/adapters/sanctions.js";
import emsc from "../pipeline/adapters/emsc.js";
import usgs from "../pipeline/adapters/usgs.js";
import cloudflare from "../pipeline/adapters/cloudflare_radar.js";
import ioda from "../pipeline/adapters/ioda.js";
import elections from "../pipeline/adapters/elections.js";

const text = f => fs.readFileSync(rel("pipeline/fixtures", f), "utf8");
const list = r => (Array.isArray(r) ? r : r.entities);
const valid = l => { for (const e of l) if (e.kind !== "measure") assert.ok(validateEntity(e), `${e.id}: ${JSON.stringify(validateEntity.errors?.slice(0, 2))}`); };
const cond = (l, layer) => l.filter(e => e.kind === "condition" && (!layer || e.layer === layer));

test("UCDP: condição por país com o tipo certo e eventos limitados", () => {
  const out = list(ucdp.normalize(fixture("ucdp.json"), ctx("ucdp")));
  const c = Object.fromEntries(cond(out).map(e => [e.place.iso2, e]));
  assert.equal(c.UA.subtype, "guerra_interestatal");
  assert.equal(c.SD.subtype, "guerra_civil");
  assert.equal(c.CD.subtype, "violencia_armada");
  assert.ok(!c.MM, "abaixo do mínimo de eventos e mortes não vira condição");
  assert.ok(!out.some(e => e.place?.name === "Atlantis"));
  assert.ok(out.filter(e => e.kind === "event" && e.place.iso2 === "UA").length <= 5);
  const m = out.find(e => e.kind === "measure" && e.subject.id === c.SD.id);
  assert.equal(m.metric, "mortes_45d");
  assert.equal(m.assertions[0].value, 250);
  for (const e of out.filter(e => e.kind === "event")) {
    if (c[e.place.iso2]) assert.equal(e.parentId, c[e.place.iso2].id, "evento aponta para a condição do país");
    else assert.equal(e.parentId, undefined, "sem condição no país, sem parentId");
  }
  valid(out);
});

test("ACLED: tipos mapeados, onda de protestos e repressão", () => {
  assert.deepEqual(mapAcled("Explosions/Remote violence", "Air/drone strike"), ["conflito", "ataque_aereo"]);
  assert.deepEqual(mapAcled("Protests", "Excessive force against protesters"), ["protesto", "repressao"]);
  assert.equal(mapAcled("Strategic developments", "Agreement"), null);
  const out = list(acled.normalize(fixture("acled.json"), ctx("acled")));
  const fr = cond(out, "protesto").find(e => e.place.iso2 === "FR");
  assert.ok(fr, "16 protestos na França viram condição");
  assert.ok(!cond(out, "protesto").some(e => e.place.iso2 === "IR"), "2 protestos não bastam");
  assert.equal(out.find(e => e.id === "acled:evt:IRN9001").subtype, "repressao");
  assert.equal(out.find(e => e.id === "acled:evt:UKR9001").subtype, "ataque_aereo");
  assert.ok(!out.some(e => e.id === "acled:evt:SDN9004"));
  valid(out);
});

test("OFAC: lê o CSV com programas múltiplos e ignora programas temáticos", () => {
  assert.deepEqual(parseCsvLine('1,"A, B","x","-0- "'), ["1", "A, B", "x", ""]);
  const out = list(ofac.normalize(text("ofac.csv"), ctx("ofac")));
  const by = Object.fromEntries(cond(out).map(e => [e.place.iso2, e]));
  assert.deepEqual(Object.keys(by).sort(), ["CU", "IR", "KP", "RU", "VE"]);
  assert.match(by.RU.text.pt.summary, /4 designações/);
  assert.match(by.CU.text.pt.summary, /1 designação ligadas/);
  assert.equal(by.RU.time.startKnown, false);
  valid(out);
});

test("ONU e UE: listas por país; terrorismo fica de fora", () => {
  const un = cond(list(unsc.normalize(text("un_sc.xml"), ctx("un_sc"))));
  assert.deepEqual(un.map(e => e.place.iso2).sort(), ["KP", "LY", "SO"]);
  const e = cond(list(eu.normalize(text("eu_sanctions.xml"), ctx("eu_sanctions"))));
  assert.deepEqual(e.map(x => x.place.iso2).sort(), ["IR", "RU", "SY"]);
});

test("sanções de emissores diferentes viram um cartão só, com cada emissor como fonte", () => {
  const all = [ofac.normalize(text("ofac.csv"), ctx("ofac")), unsc.normalize(text("un_sc.xml"), ctx("un_sc")), eu.normalize(text("eu_sanctions.xml"), ctx("eu_sanctions"))].flatMap(list);
  const out = clusterEntities(all, NOW);
  const kp = out.filter(e => e.kind === "condition" && e.place.iso2 === "KP");
  assert.equal(kp.length, 1);
  assert.deepEqual(kp[0].sources.map(s => s.sourceId).sort(), ["ofac", "un_sc"]);
  const ms = out.filter(e => e.kind === "measure" && e.subject.id === kp[0].id);
  assert.equal(ms.length, 2, "uma medida por lista, sem falsa divergência");
  assert.ok(ms.every(m => !m.disputed));
});

test("EMSC junta-se ao USGS por proximidade e as magnitudes viram versões", () => {
  const a = usgs.normalize(fixture("usgs.json"), ctx("usgs"));
  const b = emsc.normalize(fixture("emsc.json"), ctx("emsc"));
  const out = clusterEntities([...a, ...b], NOW);
  const jp = out.filter(e => e.kind === "event" && e.place.iso2 === "JP");
  assert.equal(jp.length, 1);
  assert.deepEqual(jp[0].sources.map(s => s.sourceId).sort(), ["emsc", "usgs"]);
  const m = out.find(e => e.kind === "measure" && e.subject.id === jp[0].id);
  assert.deepEqual(m.assertions.map(x => x.value).sort(), [6, 6.1]);
  assert.equal(b.find(e => e.place.iso2 === "GR").place.name, "Grécia");
});

test("Cloudflare Radar traz a causa e se junta ao IODA no mesmo dia", () => {
  const cf = cloudflare.normalize(fixture("cloudflare_radar.json"), ctx("cloudflare_radar"));
  assert.match(cf.find(e => e.place.iso2 === "IR").text.pt.summary, /ordem do governo/);
  assert.equal(cf.find(e => e.place.iso2 === "IR").intensity, 5);
  const out = clusterEntities([...cf, ...ioda.normalize(fixture("ioda.json"), ctx("ioda"))], NOW);
  const ir = out.filter(e => e.place?.iso2 === "IR");
  assert.equal(ir.length, 1);
  assert.deepEqual(ir[0].sources.map(s => s.sourceId).sort(), ["cloudflare_radar", "ioda"]);
  valid(cf);
});

test("calendário eleitoral: aparece só na janela da campanha", () => {
  const out = elections.normalize(fixture("elections.json"), ctx("eleicoes"));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "nao_verificado");
  assert.match(out[0].text.pt.summary, /Votação em 9 dias/);
  const late = elections.normalize(fixture("elections.json"), { ...ctx("eleicoes"), now: "2026-12-01T00:00:00Z" });
  assert.equal(late.length, 0);
  const near = elections.normalize(fixture("elections.json"), { ...ctx("eleicoes"), now: "2026-11-01T00:00:00Z" });
  assert.ok(near.some(e => e.subtype === "dia_de_votacao"));
  valid(out);
});

test("o calendário real é um arquivo válido", () => {
  const live = JSON.parse(fs.readFileSync(rel("data/curated/elections.json"), "utf8"));
  assert.equal(live.dataClass, "live");
  for (const el of live.elections) assert.match(el.date, /^\d{4}-\d{2}-\d{2}$/);
});

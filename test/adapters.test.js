import test from "node:test";
import assert from "node:assert/strict";
import { NOW, ctx, fixture } from "./helpers.js";
import { validateEntity } from "../pipeline/lib/validate.js";
import usgs, { placePt } from "../pipeline/adapters/usgs.js";
import gdacs from "../pipeline/adapters/gdacs.js";
import ioda from "../pipeline/adapters/ioda.js";
import kev from "../pipeline/adapters/cisa_kev.js";
import opensky from "../pipeline/adapters/opensky.js";
import ais from "../pipeline/adapters/aisstream.js";

const valid = list => { for (const e of list) assert.ok(validateEntity(e), `${e.id}: ${JSON.stringify(validateEntity.errors?.slice(0, 2))}`); };

test("USGS: só terremotos acima do mínimo, em português, válidos", () => {
  const out = usgs.normalize(fixture("usgs.json"), ctx("usgs"));
  assert.deepEqual(out.map(e => e.id).sort(), ["usgs:evt:fx26cl02", "usgs:evt:fx26id03", "usgs:evt:fx26jp01", "usgs:evt:fx26to04"]);
  const jp = out.find(e => e.id.endsWith("jp01"));
  assert.equal(jp.place.iso2, "JP");
  assert.equal(jp.magnitude.scale, "Mww");
  assert.equal(jp.status, "verificado");
  assert.match(jp.text.pt.headline, /^Terremoto de magnitude 6,1 — 88 km a L de Hasaki, Japão$/);
  const to = out.find(e => e.id.endsWith("to04"));
  assert.match(to.text.pt.summary, /centros oficiais de alerta de tsunami/);
  assert.doesNotMatch(to.text.pt.summary, /alerta de tsunami emitido/i);
  valid(out);
});

test("USGS: rótulo de lugar traduz rumos", () => {
  assert.equal(placePt("5 km WSW of Lima, Peru", { pt: "Peru" }), "5 km a OSO de Lima, Peru");
  assert.equal(placePt("Mid-Atlantic Ridge", null), "Mid-Atlantic Ridge");
});

test("GDACS: ignora terremotos (ficam com o USGS) e mapeia tipos", () => {
  const out = gdacs.normalize(fixture("gdacs.json"), ctx("gdacs"));
  assert.equal(out.length, 4);
  assert.ok(!out.some(e => e.id.includes("EQ")));
  assert.equal(out.find(e => e.id.includes("VO")).layer, "sismico");
  assert.equal(out.find(e => e.id.includes("TC")).intensity, 5);
  valid(out);
});

test("IODA: país desconhecido é descartado; causa não é inventada", () => {
  const out = ioda.normalize(fixture("ioda.json"), ctx("ioda"));
  assert.deepEqual(out.map(e => e.place.iso2).sort(), ["IR", "SN"]);
  assert.equal(out.find(e => e.place.iso2 === "IR").place.name, "Irã");
  for (const e of out) assert.match(e.text.pt.summary, /não diz a causa/);
  valid(out);
});

test("CISA KEV: janela de dias, sem local, ransomware sobe a intensidade", () => {
  const out = kev.normalize(fixture("cisa_kev.json"), ctx("cisa_kev"));
  assert.equal(out.length, 2);
  const r = out.find(e => e.id.endsWith("90001"));
  assert.equal(r.geo, null);
  assert.equal(r.subtype, "ransomware");
  assert.equal(r.intensity, 4);
  valid(out);
});

test("OpenSky: só aeronaves com indício militar e em voo", () => {
  const { observations } = opensky.normalize(fixture("opensky.json"), ctx("opensky"));
  const cs = observations.map(o => o.asset.callsign).sort();
  assert.deepEqual(cs, ["FORTE12", "GAF612", "NATO05", "RCH871"]);
  assert.equal(observations.find(o => o.asset.callsign === "NATO05").asset.flag, null);
  assert.equal(observations.find(o => o.asset.callsign === "GAF612").classification.rule, "indicativo GAF*");
});

test("AIS: tipo 35 e prefixo de nome classificam; navio civil fica de fora", () => {
  const { observations } = ais.normalize(fixture("aisstream.json"), ctx("aisstream"));
  const mmsi = [...new Set(observations.map(o => o.asset.mmsi))].sort();
  assert.deepEqual(mmsi, ["247000202", "338000001"]);
  const t35 = observations.find(o => o.asset.mmsi === "247000202");
  assert.match(t35.classification.rule, /tipo AIS 35/);
  assert.equal(t35.sample.headingDeg, 95, "TrueHeading 511 cai para o rumo sobre o fundo");
});

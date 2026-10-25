// Gera os dados geográficos derivados do Natural Earth (domínio público):
//   pipeline/data/admin1.json  — estados/províncias, para achar o estado de um ponto
//   geo/admin1/XX.json         — contornos simplificados por país, carregados pelo app sob demanda
//   pipeline/data/countries.json (campo bbox) — caixa do território principal, para o zoom
// uso: node scripts/build-geo.js caminho/ne_10m_admin_1_states_provinces.geojson
// fonte: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
import fs from "node:fs";
import { readJson, rel, writeJson } from "../pipeline/lib/util.js";
import { simplify, flat, bboxOf } from "./lib/simplify.js";

const src = process.argv[2];
if (!src) { console.error("informe o caminho do GeoJSON de admin-1 do Natural Earth"); process.exit(1); }
const ne = JSON.parse(fs.readFileSync(src, "utf8"));
const countries = readJson(rel("pipeline/data/countries.json"));
const known = new Set(countries.map(c => c.iso2));

const index = [], perCountry = new Map();
for (const f of ne.features) {
  const p = f.properties, iso2 = p.iso_a2;
  if (!known.has(iso2) || !f.geometry) continue;
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  const code = /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(p.iso_3166_2 || "") ? p.iso_3166_2 : null;
  // name_pt do Natural Earth às vezes corta o nome ("Federal" para "Distrito Federal"); aí vale o nome local.
  const cut = p.name_pt && p.name && p.name !== p.name_pt && p.name.endsWith(" " + p.name_pt);
  const name = (cut ? p.name : p.name_pt) || p.name || p.name_en || p.gn_name || code || p.adm1_code;
  const full = [], light = [];
  let bb = [180, 90, -180, -90];
  for (const poly of polys) {
    const rings = poly.map(r => simplify(r, 0.02)).filter(r => r.length >= 4);
    if (!rings.length) continue;
    const b = bboxOf(rings[0]);
    bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])];
    full.push(rings.map(r => flat(r, 2)));
    if (b[2] - b[0] > 0.08 || b[3] - b[1] > 0.08) {
      const outer = simplify(poly[0], 0.025);
      if (outer.length >= 4) light.push(flat(outer, 2));
    }
  }
  if (!full.length) continue;
  index.push({ code, iso2, name, type: p.type_en || null, lat: +(+p.latitude).toFixed(3), lon: +(+p.longitude).toFixed(3), bbox: bb.map(v => +v.toFixed(3)), polys: full });
  if (!perCountry.has(iso2)) perCountry.set(iso2, []);
  perCountry.get(iso2).push({ code, name, type: p.type_en || null, lat: +(+p.latitude).toFixed(2), lon: +(+p.longitude).toFixed(2), rings: light });
}
writeJson(rel("pipeline/data/admin1.json"), index);
fs.rmSync(rel("geo/admin1"), { recursive: true, force: true });
fs.mkdirSync(rel("geo/admin1"), { recursive: true });
let bytes = 0;
for (const [iso2, regions] of perCountry) {
  regions.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const body = JSON.stringify({ iso2, source: "Natural Earth 1:10m (domínio público)", regions });
  fs.writeFileSync(rel(`geo/admin1/${iso2}.json`), body);
  bytes += body.length;
}

// Caixa do território principal de cada país (maior polígono da malha 1:110m), para o zoom do app.
const topo = readJson(rel("pipeline/data/world-110m.json"));
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
const ring = r => r.flatMap((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; return k ? a.slice(1) : a; });
const area = pts => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0) / 2);
for (const g of topo.objects.countries.geometries) {
  const c = countries.find(x => x.num === String(g.id).padStart(3, "0"));
  if (!c) continue;
  const main = (g.type === "MultiPolygon" ? g.arcs : [g.arcs]).map(p => ring(p[0])).sort((a, b) => area(b) - area(a))[0];
  c.bbox = bboxOf(main).map(v => +v.toFixed(2));
}
for (const c of countries) if (!c.bbox) c.bbox = [c.lon - 0.5, c.lat - 0.5, c.lon + 0.5, c.lat + 0.5].map(v => +v.toFixed(2));
fs.writeFileSync(rel("pipeline/data/countries.json"), JSON.stringify(countries));
console.log(`${index.length} estados/províncias; ${perCountry.size} países; app: ${(bytes / 1024).toFixed(0)} KB no total`);

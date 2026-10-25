import { readJson, rel } from "./util.js";

// Nomes em português do Brasil. A tabela gerada vem da lista ISO em português europeu,
// e troca os dois Congos; estas correções valem sobre ela.
const PT_BR = {
  AM: "Armênia", BA: "Bósnia e Herzegovina", BJ: "Benin", CD: "República Democrática do Congo", CG: "República do Congo",
  CZ: "Tchéquia", DJ: "Djibuti", EE: "Estônia", GL: "Groenlândia", IR: "Irã", KE: "Quênia", KW: "Kuwait", LV: "Letônia",
  MC: "Mônaco", MG: "Madagascar", MK: "Macedônia do Norte", MM: "Mianmar", MU: "Maurício", NC: "Nova Caledônia",
  PL: "Polônia", PS: "Territórios Palestinos", QA: "Catar", RO: "Romênia", SI: "Eslovênia", TT: "Trinidad e Tobago",
  VN: "Vietnã", YE: "Iêmen",
};
const COUNTRIES = readJson(rel("pipeline/data/countries.json")).map(c => (PT_BR[c.iso2] ? { ...c, pt: PT_BR[c.iso2] } : c));
const byIso2 = new Map(COUNTRIES.map(c => [c.iso2, c]));
const byIso3 = new Map(COUNTRIES.map(c => [c.iso3, c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Grafias usadas por fontes (OpenSky, USGS) que não batem com os nomes ISO.
const EXTRA_ALIASES = {
  US: ["united states", "usa", "u s"], GB: ["united kingdom", "uk", "great britain"], RU: ["russia", "russian federation"],
  KR: ["republic of korea", "south korea", "korea south"], KP: ["north korea", "korea north", "dprk"],
  IR: ["iran", "iran islamic republic of"], VN: ["viet nam", "vietnam"], TW: ["taiwan"], SY: ["syria", "syrian arab republic"],
  BO: ["bolivia"], VE: ["venezuela"], TZ: ["tanzania"], LA: ["laos", "lao people s democratic republic"],
  MD: ["moldova", "republic of moldova"], CD: ["democratic republic of the congo", "dr congo", "congo kinshasa"],
  CG: ["republic of the congo", "congo brazzaville"], CZ: ["czech republic", "czechia"], TR: ["turkey", "turkiye"],
  MK: ["north macedonia", "macedonia"], PS: ["palestine", "state of palestine"], CI: ["ivory coast", "cote d ivoire"],
};
const byName = new Map();
for (const c of COUNTRIES) for (const n of [c.pt, c.en, ...(c.aliases || []), ...(EXTRA_ALIASES[c.iso2] || [])]) byName.set(norm(n), c);

// Polígonos para geocodificação reversa (ponto -> país).
const topo = readJson(rel("pipeline/data/world-110m.json"));
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
const ring = r => r.flatMap((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; return k ? a.slice(1) : a; });
const SHAPES = [];
for (const g of topo.objects.countries.geometries) {
  const c = COUNTRIES.find(x => x.num === String(g.id).padStart(3, "0"));
  if (!c) continue;
  for (const p of g.type === "MultiPolygon" ? g.arcs : [g.arcs]) {
    const rings = p.map(ring);
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    SHAPES.push({ c, rings, bbox: [x0, y0, x1, y1] });
  }
}
function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lista [iso2, nome] em português do Brasil, em ordem alfabética. */
export const allCountries = () => COUNTRIES.map(c => [c.iso2, c.pt]).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

export const country = code => (code?.length === 3 ? byIso3.get(code) : byIso2.get(code)) || null;
export const countryByNum = n => (n == null || n === "" ? null : COUNTRIES.find(c => c.num === String(n).padStart(3, "0")) || null);
export const countryByName = name => byName.get(norm(name)) || null;

/** País que contém o ponto, ou null em alto-mar. */
export function countryAt(lat, lon) {
  for (const s of SHAPES) {
    const [x0, y0, x1, y1] = s.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (inRing(lon, lat, s.rings[0]) && !s.rings.slice(1).some(h => inRing(lon, lat, h))) return s.c;
  }
  return null;
}

export function placeOf(c, admin1 = null) {
  return c ? { iso2: c.iso2, iso3: c.iso3, name: c.pt, admin1 } : { iso2: null, iso3: null, name: "Alto-mar", admin1 };
}
export const GLOBAL_PLACE = { iso2: null, iso3: null, name: "Global", admin1: null };
export const point = (lat, lon) => ({ type: "Point", coordinates: [+lon.toFixed(3), +lat.toFixed(3)] });
export const inBox = (lat, lon, [s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e;

// Estados e províncias (Natural Earth 1:10m simplificado), carregados na primeira consulta.
let ADMIN1 = null, ADMIN1_BY = null;
function admin1() {
  if (!ADMIN1) {
    ADMIN1 = readJson(rel("pipeline/data/admin1.json"));
    ADMIN1_BY = new Map();
    for (const a of ADMIN1) { if (!ADMIN1_BY.has(a.iso2)) ADMIN1_BY.set(a.iso2, []); ADMIN1_BY.get(a.iso2).push(a); }
  }
  return ADMIN1_BY;
}
const inFlat = (x, y, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Estado que contém o ponto, dentro do país informado (ou em qualquer país, se iso2 for null). */
export function admin1At(lat, lon, iso2 = null) {
  const by = admin1();
  const lists = iso2 ? [by.get(iso2) || []] : [...by.values()];
  for (const list of lists) for (const a of list) {
    const [w, s, e, n] = a.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    for (const poly of a.polys) if (inFlat(lon, lat, poly[0]) && !poly.slice(1).some(h => inFlat(lon, lat, h))) return a;
  }
  return null;
}

/** Procura nomes de estados de um país num texto (manchete). Devolve o primeiro encontrado. */
export function admin1InText(text, iso2) {
  const list = admin1().get(iso2) || [];
  const t = ` ${norm(text)} `;
  let best = null;
  for (const a of list) {
    const n = norm(a.name);
    if (n.length >= 4 && t.includes(` ${n} `) && (!best || n.length > norm(best.name).length)) best = a;
  }
  return best;
}
export const admin1List = iso2 => admin1().get(iso2) || [];

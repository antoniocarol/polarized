// Copia para o index.html os blocos que o app compartilha com o pipeline:
// contornos do mundo, taxonomia, países, prompt, camadas de proteção e índice de atenção.
// uso: node scripts/sync-app.js [--check]   (--check falha se o app estiver desatualizado)
import fs from "node:fs";
import { readJson, rel } from "../pipeline/lib/util.js";
import { allCountries, country } from "../pipeline/lib/geo.js";
import { simplify, bboxOf } from "./lib/simplify.js";

const strip = f => fs.readFileSync(rel(f), "utf8").replace(/^export /gm, "").trim();

/** Contornos 1:110m simplificados, com o país de cada anel (para tocar no país). */
function rings() {
  const topo = readJson(rel("pipeline/data/world-110m.json"));
  const countries = readJson(rel("pipeline/data/countries.json"));
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
  const ring = r => r.flatMap((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; return k ? a.slice(1) : a; });
  const out = [], iso = [];
  for (const g of topo.objects.countries.geometries) {
    const c = countries.find(x => x.num === String(g.id).padStart(3, "0"));
    const polys = (g.type === "MultiPolygon" ? g.arcs : [g.arcs]).map(p => ring(p[0]));
    const span = r => { const [w, s, e, n] = bboxOf(r); return Math.max(e - w, n - s); };
    const biggest = polys.reduce((a, b) => (span(b) > span(a) ? b : a), polys[0]);
    for (const r of polys) {
      if (span(r) < 1.4 && r !== biggest) continue;
      const pts = simplify(r, 0.3);
      if (pts.length < 4) continue;
      out.push(pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
      iso.push(c ? c.iso2 : "");
    }
  }
  return `const RINGS = ${JSON.stringify(out)};\nconst RING_ISO = ${JSON.stringify(iso)};`;
}

export function blocks() {
  const t = readJson(rel("schema/taxonomy.json"));
  const layers = Object.fromEntries(Object.entries(t.layers).map(([k, v]) => [k, { label: v.label, color: v.color, frame: v.frame, desc: v.desc, subtypes: v.subtypes }]));
  return {
    RINGS: rings(),
    TAXONOMY: `const LAYERS = ${JSON.stringify(layers)};\nconst STATUS = ${JSON.stringify(t.status)};\nconst CATS = LAYERS;`,
    COUNTRIES: `const COUNTRIES = ${JSON.stringify(allCountries().map(([iso2, pt]) => { const c = country(iso2); return [iso2, pt, c.lat, c.lon, c.bbox]; }))};`,
    SHARED: ["pipeline/lib/prompt.js", "pipeline/lib/guards.js", "pipeline/lib/attention.js"].map(strip).join("\n\n"),
  };
}

export function apply(html) {
  for (const [name, body] of Object.entries(blocks())) {
    const re = new RegExp(`(/\\* @generated ${name}[^\\n]*\\*/\\n)[\\s\\S]*?(/\\* @end ${name} \\*/)`);
    if (!re.test(html)) throw new Error(`marcador ${name} não encontrado no index.html`);
    html = html.replace(re, (_, a, b) => `${a}${body}\n${b}`);
  }
  return html;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = rel("index.html");
  const html = fs.readFileSync(file, "utf8");
  const next = apply(html);
  if (process.argv.includes("--check")) {
    if (next !== html) { console.error("index.html desatualizado: rode npm run sync-app"); process.exit(1); }
    console.log("index.html em dia");
  } else { fs.writeFileSync(file, next); console.log("index.html sincronizado"); }
}

// Copia para o index.html os blocos que o app compartilha com o pipeline:
// taxonomia, lista de países, prompt e camadas de proteção da análise.
// uso: node scripts/sync-app.js [--check]   (--check falha se o app estiver desatualizado)
import fs from "node:fs";
import { readJson, rel } from "../pipeline/lib/util.js";
import { allCountries } from "../pipeline/lib/geo.js";

const strip = f => fs.readFileSync(rel(f), "utf8").replace(/^export /gm, "").trim();

export function blocks() {
  const t = readJson(rel("schema/taxonomy.json"));
  const layers = Object.fromEntries(Object.entries(t.layers).map(([k, v]) => [k, { label: v.label, color: v.color, frame: v.frame, desc: v.desc, subtypes: v.subtypes }]));
  return {
    TAXONOMY: `const LAYERS = ${JSON.stringify(layers)};\nconst STATUS = ${JSON.stringify(t.status)};\nconst CATS = LAYERS;`,
    COUNTRIES: `const COUNTRIES = ${JSON.stringify(allCountries())};`,
    SHARED: `${strip("pipeline/lib/prompt.js")}\n\n${strip("pipeline/lib/guards.js")}`,
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

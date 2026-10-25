// Curadoria — condições mantidas por pessoas do projeto (guerras, eleições, sanções, tarifas),
// em data/curated/*.json, já no formato do esquema. Cada arquivo declara dataClass:
// "example" entra só com --fixtures; "live" entra só na execução real.
import fs from "node:fs";
import { readJson, rel } from "../lib/util.js";

export default {
  id: "curadoria",
  fixture: null,
  async fetch(ctx) {
    const dir = rel("data/curated");
    const want = ctx.fixtures ? "example" : "live";
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => readJson(`${dir}/${f}`)).filter(f => f.dataClass === want);
  },
  normalize(files) {
    const entities = files.flatMap(f => f.entities || []);
    const sources = Object.assign({}, ...files.map(f => f.sources || {}));
    return { entities, sources };
  },
};

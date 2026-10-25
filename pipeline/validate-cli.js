import { readJson } from "./lib/util.js";
import { validateSnapshot } from "./lib/validate.js";

const file = process.argv[2] || "public/snapshot.json";
const snap = readJson(file);
const { errors, warnings } = validateSnapshot(snap);
for (const w of warnings) console.log("AVISO", w);
for (const e of errors) console.log("ERRO ", e);
console.log(`${file}: ${snap.entities.length} entidades, ${errors.length} erros, ${warnings.length} avisos`);
process.exit(errors.length ? 1 : 0);

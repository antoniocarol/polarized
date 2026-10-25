// Monta o site estático para hospedagem própria (GitHub Pages ou qualquer CDN):
// _site/index.html com o documento completo, _site/snapshot.json e os estados de cada país
// (_site/geo/admin1/XX.json, carregados só quando alguém dá zoom num país).
import fs from "node:fs";
import { rel } from "../pipeline/lib/util.js";

const src = process.argv[2] || "public/snapshot.json";
fs.mkdirSync(rel("_site"), { recursive: true });
const page = fs.readFileSync(rel("index.html"), "utf8");
const head = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style></head><body>";
fs.writeFileSync(rel("_site/index.html"), `${head}${page}</body></html>`);
fs.copyFileSync(rel(src), rel("_site/snapshot.json"));
fs.cpSync(rel("geo/admin1"), rel("_site/geo/admin1"), { recursive: true });
console.log(`_site/ pronto (snapshot de ${src})`);

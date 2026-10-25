// Classifica cada relato: país, estado, camada, subtipo, tópico (para agrupar histórias) e
// manchete em português. Primeiro por palavras-chave (sempre); depois pelo modelo, só para
// relatos novos, com a resposta conferida campo a campo.
import { country, admin1InText, admin1List, allCountries } from "./geo.js";
import { readJson, rel } from "./util.js";

const TAX = readJson(rel("schema/taxonomy.json")).layers;
const norm = s => ` ${String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ")} `;

const LEX = [
  ["conflito", /\b(guerra|war|ataque|attack|bombard\w*|missil|missile|drone|ofensiva|offensive|tropas|troops|combate\w*|fighting|clash\w*|cessar fogo|ceasefire|airstrike|shelling|rebel\w*|insurg\w*|militia|milicia)\b/],
  ["sismico", /\b(terremoto|earthquake|sismo|quake|vulcao|volcano|erupcao|eruption|tsunami)\b/],
  ["clima", /\b(chuva\w*|rain\w*|deslizamento\w*|landslide\w*|enchente\w*|flood\w*|inundac\w*|furacao|hurricane|ciclone|cyclone|tufao|typhoon|tempestade|storm|seca|drought|incendio\w*|wildfire\w*|onda de calor|heatwave|heat wave)\b/],
  ["protesto", /\b(protest\w*|manifesta\w*|greve|general strike|riot\w*|tumulto\w*|crackdown|repress\w*)\b/],
  ["eleicao", /\b(eleic\w*|election\w*|eleitor\w*|voter\w*|votac\w*|referend\w*|candidat\w*|debate|segundo turno|runoff|ballot)\b/],
  ["ciber", /\b(hacker\w*|ciberataque\w*|cyberattack\w*|cyber attack|ransomware|vazamento de dados|data breach|ddos|malware|internet shutdown|apagao de internet)\b/],
  ["diplomacia", /\b(sanc\w*|sanction\w*|embargo|cupula|summit|tratado|treaty|acordo de paz|peace deal|embaixad\w*|ambassador|diplomat\w*|chanceler|foreign minister)\b/],
  ["economia", /\b(tarifa\w*|tariff\w*|bolsa\w*|stocks?|inflac\w*|inflation|juros|interest rates?|banco central|central bank|pib|gdp|recess\w*|exporta\w*|importa\w*|trade|comercio|moeda|currency|dolar|dollar|petroleo|oil prices?|ibovespa|nasdaq|dow jones|wall street|acoes|shares|mercado financeiro)\b/],
];
const SUB = {
  conflito: [[/\b(cessar fogo|ceasefire|truce|tregua)\b/, "cessar_fogo"], [/\b(airstrike|ataque aereo|drone)\b/, "ataque_aereo"], [/\b(shelling|bombard\w*|missil|missile)\b/, "bombardeio"]],
  protesto: [[/\b(riot\w*|tumulto\w*)\b/, "tumulto"], [/\b(crackdown|repress\w*)\b/, "repressao"], [/\b(greve|general strike)\b/, "greve_geral"]],
  eleicao: [[/\b(debate)\b/, "debate"], [/\b(segundo turno|runoff)\b/, "segundo_turno"], [/\b(referend\w*)\b/, "referendo"]],
  sismico: [[/\b(vulcao|volcano|erupcao|eruption)\b/, "vulcao"], [/\b(tsunami)\b/, "alerta_tsunami"]],
  clima: [[/\b(flood\w*|enchente\w*|inundac\w*)\b/, "enchente"], [/\b(wildfire\w*|incendio\w*)\b/, "incendio"], [/\b(seca|drought)\b/, "seca"], [/\b(heat\w*|calor)\b/, "onda_calor"]],
  economia: [[/\b(tarifa\w*|tariff\w*)\b/, "tarifa"], [/\b(bolsa\w*|stocks?|ibovespa|nasdaq|wall street|acoes|shares)\b/, "indice_bolsa"], [/\b(moeda|currency|dolar|dollar)\b/, "cambio"]],
  diplomacia: [[/\b(sanc\w*|sanction\w*)\b/, "sancoes"], [/\b(embargo)\b/, "embargo"], [/\b(cupula|summit)\b/, "cupula"], [/\b(tratado|treaty|acordo de paz|peace deal)\b/, "tratado"]],
  ciber: [[/\b(ransomware)\b/, "ransomware"], [/\b(ddos)\b/, "ddos"], [/\b(internet shutdown|apagao de internet)\b/, "queda_internet"]],
};
const DEFAULT_SUB = { conflito: "confronto_armado", protesto: "manifestacao", eleicao: "periodo_de_campanha", sismico: "terremoto", clima: "tempestade",
  economia: null, diplomacia: "sancoes", ciber: "incidente" };

// Cidades e regiões indicam onde o fato acontece; gentílicos só dizem quem participa.
const PLACES = { UA: "kyiv kiev kharkiv odesa zaporizhzhia donetsk luhansk kherson dnipro", RU: "moscow moscou kremlin belgorod kursk",
  PS: "gaza west bank cisjordania rafah", IL: "tel aviv jerusalem jerusalém", IR: "tehran teera", CN: "beijing pequim shanghai xangai",
  BR: "brasilia sao paulo rio de janeiro", SD: "khartoum cartum darfur el fasher", VE: "caracas", FR: "paris", DE: "berlin berlim",
  GB: "london londres", JP: "tokyo toquio", SY: "damascus damasco aleppo alepo", LB: "beirut beirute", TR: "ankara istanbul",
  SA: "riyadh riad", YE: "sanaa aden", US: "white house casa branca pentagon pentagono", KP: "pyongyang", HT: "port au prince",
  CD: "kinshasa goma", AF: "kabul cabul", AR: "buenos aires", CO: "bogota", PE: "lima", EG: "cairo", ID: "jakarta", PH: "manila", IN: "new delhi nova delhi mumbai" };
const DEMONYMS = { UA: "ukrainian ucraniano ucraniana", RU: "russian russo russa putin", IL: "israeli israelense", PS: "palestinian palestino palestina",
  IR: "iranian iraniano iraniana", CN: "chinese chines chinesa", BR: "brazilian brasileiro brasileira ibovespa", IN: "indian indiano", PK: "pakistani paquistanes",
  SD: "sudanese sudanes", VE: "venezuelan venezuelano", MX: "mexican mexicano", FR: "french frances", DE: "german alemao alema", GB: "british britanico",
  JP: "japanese japones", SY: "syrian sirio", LB: "lebanese libanes", TR: "turkish turco", SA: "saudi saudita", YE: "houthi houthis", KP: "north korean norte coreano",
  US: "trump biden", AF: "taliban afghan afegao" };
const NAMES = [];   // [nome, iso2, peso]
const add = (n, iso2, w) => { n = norm(n).trim(); if (n.length >= 4) NAMES.push([n, iso2, w]); };
for (const [iso2, words] of Object.entries(PLACES)) for (const w of words.split(/ (?=[a-z])/)) add(w, iso2, 3);
for (const [iso2, pt] of allCountries()) { const c = country(iso2); for (const n of [pt, c.en, ...(c.aliases || [])]) add(n, iso2, 2); }
for (const [iso2, words] of Object.entries(DEMONYMS)) for (const w of words.split(" ")) add(w, iso2, 1);
NAMES.sort((a, b) => b[0].length - a[0].length);
// Estados e províncias de todos os países, para manchetes que só citam o estado.
const ADMIN_NAMES = [];
for (const [iso2] of allCountries()) for (const a of admin1List(iso2)) {
  const n = norm(a.name).trim();
  if (n.length >= 6 && !NAMES.some(([m, , w]) => w === 2 && m === n)) ADMIN_NAMES.push([n, iso2, a]);
}
ADMIN_NAMES.sort((a, b) => b[0].length - a[0].length);

export function keywordClassify(text) {
  const t = norm(text);
  let iso2 = null, bestW = 0, pos = 1e9, a1 = null;
  for (const [n, c, w] of NAMES) {
    const i = t.indexOf(` ${n} `);
    if (i >= 0 && (w > bestW || (w === bestW && i < pos))) { bestW = w; pos = i; iso2 = c; }
  }
  if (bestW < 3) for (const [n, c, a] of ADMIN_NAMES) {
    if (t.includes(` ${n} `) && (bestW < 2 || c === iso2)) { iso2 = c; a1 = a; break; }
  }
  let layer = null, best = 0;
  for (const [L, re] of LEX) { const n = (t.match(new RegExp(re.source, "g")) || []).length; if (n > best) { best = n; layer = L; } }
  const subtype = layer ? (SUB[layer] || []).find(([re]) => re.test(t))?.[1] || DEFAULT_SUB[layer] : null;
  if (!a1 && iso2) a1 = admin1InText(text, iso2);
  return { iso2, layer, subtype, admin1: a1 ? a1.name : null, admin1Code: a1 ? a1.code : null, topic: null, summaryPt: null };
}

const CLS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["i", "iso2", "admin1", "layer", "subtype", "topic", "summaryPt"],
    properties: { i: { type: "integer" }, iso2: { anyOf: [{ type: "string" }, { type: "null" }] }, admin1: { anyOf: [{ type: "string" }, { type: "null" }] },
      layer: { anyOf: [{ type: "string" }, { type: "null" }] }, subtype: { anyOf: [{ type: "string" }, { type: "null" }] },
      topic: { type: "string" }, summaryPt: { type: "string" } } } } },
};
function clsPrompt(batch) {
  const layers = Object.entries(TAX).filter(([k]) => k !== "militar").map(([k, v]) => `${k}: ${Object.keys(v.subtypes).join(", ")}`).join("\n");
  return [
    "Classifique cada manchete de imprensa abaixo. Para cada item devolva:",
    "- iso2: código ISO-3166 alfa-2 do país onde o fato acontece (não o país do veículo). null se for global ou não der para saber.",
    "- admin1: nome do estado ou província, só se estiver explícito no texto; senão null.",
    "- layer e subtype: uma das camadas e um dos subtipos desta lista, ou null se nenhuma se aplica:",
    layers,
    "- topic: 3 a 8 palavras em inglês que nomeiam a história. Manchetes sobre o mesmo fato, em qualquer língua, devem receber o mesmo topic.",
    "- summaryPt: a manchete em português do Brasil, fiel ao original, até 160 caracteres. Não acrescente nada que não esteja na manchete.",
    "",
    JSON.stringify(batch.map((r, i) => ({ i, title: r.title, excerpt: r.excerpt ? r.excerpt.slice(0, 160) : null }))),
  ].join("\n");
}

function accept(raw) {
  const out = { iso2: null, layer: null, subtype: null, admin1: null, admin1Code: null, topic: null, summaryPt: null };
  const c = raw.iso2 && country(String(raw.iso2).toUpperCase());
  if (c) out.iso2 = c.iso2;
  if (raw.layer && TAX[raw.layer] && raw.layer !== "militar") {
    out.layer = raw.layer;
    out.subtype = raw.subtype && TAX[raw.layer].subtypes[raw.subtype] ? raw.subtype : DEFAULT_SUB[raw.layer] || null;
  }
  if (out.iso2 && raw.admin1) { const a = admin1InText(raw.admin1, out.iso2); if (a) { out.admin1 = a.name; out.admin1Code = a.code; } }
  out.topic = raw.topic ? String(raw.topic).slice(0, 80) : null;
  out.summaryPt = raw.summaryPt ? String(raw.summaryPt).slice(0, 200) : null;
  return out;
}

/** Classifica no lugar. cache: { [reportId]: { cls, at } } — devolvido podado para o estado. */
export async function classifyReports(reports, { client, ask, cache = {}, now, log = () => {}, batchSize = 60 }) {
  const fresh = {};
  for (const [k, v] of Object.entries(cache)) if (Date.parse(now) - Date.parse(v.at) < 72 * 3600e3) fresh[k] = v;
  const todo = [];
  for (const r of reports) {
    if (fresh[r.id]) { apply(r, fresh[r.id].cls, fresh[r.id].by); continue; }
    apply(r, keywordClassify(`${r.title} ${r.excerpt || ""}`), "palavras-chave");
    if (client) todo.push(r);
  }
  let calls = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    try {
      const res = await ask(client, clsPrompt(batch), CLS_SCHEMA);
      calls++;
      for (const it of res.data.items || []) {
        const r = batch[it.i]; if (!r) continue;
        const cls = accept(it);
        apply(r, cls, "modelo");
        fresh[r.id] = { cls, by: "modelo", at: now };
      }
    } catch (e) { log(`classificação de notícias pelo modelo falhou: ${e.message}; mantidas as palavras-chave`); break; }
  }
  for (const r of reports) if (!fresh[r.id] && r.classifiedBy === "palavras-chave") fresh[r.id] = { cls: snapshotCls(r), by: "palavras-chave", at: now };
  return { cache: fresh, calls };
}
function snapshotCls(r) {
  return { iso2: r.place?.iso2 || null, layer: r.layer, subtype: r.subtype, admin1: r.place?.admin1 || null, admin1Code: r.place?.admin1Code || null, topic: r.topic, summaryPt: r.summaryPt };
}
function apply(r, cls, by) {
  const c = cls.iso2 ? country(cls.iso2) : null;
  r.place = c ? { iso2: c.iso2, iso3: c.iso3, name: c.pt, admin1: cls.admin1 || null, admin1Code: cls.admin1Code || null } : null;
  r.layer = cls.layer || null;
  r.subtype = cls.layer ? cls.subtype || null : null;
  r.topic = cls.topic || null;
  if (cls.summaryPt) r.summaryPt = cls.summaryPt;
  r.classifiedBy = by;
}

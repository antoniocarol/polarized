// Classifica cada relato: país, estado, camada, subtipo, tópico (para agrupar histórias) e
// manchete em português. Primeiro por palavras-chave (sempre); depois pelo modelo, só para
// relatos novos, com a resposta conferida campo a campo.
import { country, admin1InText, admin1List, allCountries } from "./geo.js";
import { readJson, rel } from "./util.js";

const TAX = readJson(rel("schema/taxonomy.json")).layers;
// Normaliza em qualquer escrita: sem acentos nem sinais diacríticos, só letras e números separados por espaço.
const norm = s => ` ${String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ")} `;
// Chinês e japonês não separam palavras por espaço: ali o nome vale como trecho do texto.
const CJK = /[\u3040-\u30ff\u4e00-\u9fff]/;
// Em árabe, preposições e conjunções de uma letra colam no nome (وأوكرانيا, بغزة).
const AR_PREFIX = "[وبلفك]?";
function hasName(t, n) {
  if (CJK.test(n)) return t.indexOf(n) >= 0 ? t.indexOf(n) : -1;
  const i = t.indexOf(` ${n} `);
  if (i >= 0 || !/[\u0600-\u06ff]/.test(n)) return i;
  const m = new RegExp(` ${AR_PREFIX}${n} `).exec(t);
  return m ? m.index : -1;
}

const LEX = [
  ["conflito", /\b(guerras?|wars?|ataques?|attack\w*|bombard\w*|misse[il]\w*|missil|missiles?|drones?|ofensiva|offensive|tropas|troops|combate\w*|fighting|clash\w*|cessar fogo|ceasefire|airstrike|shelling|rebel\w*|insurg\w*|militia|milicia)\b/],
  ["sismico", /\b(terremoto|earthquake|sismo|quake|vulcao|volcano|erupcao|eruption|tsunami)\b/],
  ["clima", /\b(chuva\w*|rain\w*|deslizamento\w*|landslide\w*|enchente\w*|flood\w*|inundac\w*|furacao|hurricane|ciclone|cyclone|tufao|typhoon|tempestade|storm|seca|drought|incendio\w*|wildfire\w*|onda de calor|heatwave|heat wave)\b/],
  ["protesto", /\b(protest\w*|manifesta\w*|greve|general strike|riot\w*|tumulto\w*|crackdown|repress\w*)\b/],
  ["eleicao", /\b(eleic\w*|election\w*|eleitor\w*|voter\w*|votac\w*|referend\w*|candidat\w*|debate|segundo turno|runoff|ballot)\b/],
  ["ciber", /\b(hacker\w*|ciberataque\w*|cyberattack\w*|cyber attack|ransomware|vazamento de dados|data breach|ddos|malware|internet shutdown|apagao de internet)\b/],
  ["diplomacia", /\b(sanc\w*|sanction\w*|embargo|cupula|summit|tratado|treaty|acordo de paz|peace deal|embaixad\w*|ambassador|diplomat\w*|chanceler|foreign minister)\b/],
  ["economia", /\b(tarifa\w*|tariff\w*|bolsa\w*|stocks?|inflac\w*|inflation|juros|interest rates?|banco central|central bank|pib|gdp|recess\w*|exporta\w*|importa\w*|trade|comercio|moeda|currency|dolar|dollar|petroleo|oil prices?|ibovespa|nasdaq|dow jones|wall street|acoes|shares|mercado financeiro)\b/],
];
// Espanhol e francês (já sem acento) e, sem fronteira de palavra, árabe e chinês.
const LEX_INTL = [
  ["conflito", /\b(guerre|attaque\w*|frappes? aeriennes?|bombardeo\w*|drones?|dron|combats?|tropas|troupes|enfrentamiento\w*|affrontement\w*|alto el fuego|cessez le feu)\b|حرب|هجوم|غارة|قصف|صاروخ|مسيرة|اشتباك|وقف إطلاق النار|战争|袭击|空袭|炮击|导弹|无人机|交火|停火/g],
  ["sismico", /\b(seisme|tremblement de terre|volcan)\b|زلزال|بركان|تسونامي|地震|火山|海啸/g],
  ["clima", /\b(inondation\w*|huracan|ouragan|tormenta|tempete|sequia|secheresse|lluvias?|pluies?|incendie\w*)\b|فيضان|سيول|إعصار|عاصفة|جفاف|حريق|洪水|暴雨|台风|飓风|干旱|山火/g],
  ["protesto", /\b(protesta\w*|huelga|greve)\b|احتجاج|مظاهر|إضراب|抗议|示威|罢工/g],
  ["eleicao", /\b(eleccion\w*|elections?|electoral|scrutin|vote|votacion)\b|انتخاب|اقتراع|استفتاء|选举|投票|公投/g],
  ["ciber", /\b(ciberataque\w*|cyberattaque\w*|piratage|apagon de internet|coupure d internet)\b|هجوم إلكتروني|اختراق|انقطاع الإنترنت|网络攻击|黑客|勒索软件|断网|网络中断/g],
  ["diplomacia", /\b(sancion\w*|cumbre|sommet|tratado|traite)\b|عقوبات|قمة|معاهدة|سفير|制裁|峰会|条约|外交/g],
  ["economia", /\b(arancel\w*|droits de douane|bourse|inflacion|economia|economie)\b|رسوم جمركية|بورصة|تضخم|اقتصاد|关税|股市|通胀|经济/g],
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
const PLACES = {
  UA: "kyiv, kiev, kiew, kharkiv, kharkov, jarkov, odesa, odessa, zaporizhzhia, zaporiyia, donetsk, luhansk, kherson, jerson, dnipro, كييف, خاركيف, أوديسا, 基辅, 哈尔科夫, 敖德萨",
  RU: "moscow, moscou, moscu, kremlin, belgorod, kursk, موسكو, الكرملين, 莫斯科, 克里姆林宫",
  PS: "gaza, west bank, cisjordania, cisjordanie, rafah, غزة, الضفة الغربية, 加沙", IL: "tel aviv, jerusalem, jerusalém, تل أبيب, 特拉维夫",
  IR: "tehran, teera, teheran, طهران, 德黑兰", CN: "beijing, pequim, pekin, shanghai, xangai, بكين, 北京, 上海",
  BR: "brasilia, são paulo, sao paulo, rio de janeiro", SD: "khartoum, cartum, jartum, darfur, el fasher, الخرطوم, دارفور, الفاشر, 达尔富尔",
  VE: "caracas", FR: "paris", DE: "berlin, berlim", GB: "london, londres, downing street", JP: "tokyo, toquio, tokio, 东京",
  SY: "damascus, damasco, damas, aleppo, alepo, alep, دمشق, حلب", LB: "beirut, beirute, beyrouth, بيروت", TR: "ankara, istanbul",
  SA: "riyadh, riad, الرياض", YE: "sanaa, aden, صنعاء, عدن", US: "white house, casa branca, maison blanche, pentagon, pentagono, البيت الأبيض, 白宫",
  KP: "pyongyang, 平壤", HT: "port au prince", CD: "kinshasa, goma", AF: "kabul, cabul, كابول", AR: "buenos aires", CO: "bogota",
  PE: "lima", EG: "cairo, القاهرة", ID: "jakarta", PH: "manila", IN: "new delhi, nova delhi, mumbai, नई दिल्ली",
};
const DEMONYMS = { UA: "ukrainian ucraniano ucraniana", RU: "russian russo russa putin", IL: "israeli israelense", PS: "palestinian palestino palestina",
  IR: "iranian iraniano iraniana", CN: "chinese chines chinesa", BR: "brazilian brasileiro brasileira ibovespa", IN: "indian indiano", PK: "pakistani paquistanes",
  SD: "sudanese sudanes", VE: "venezuelan venezuelano", MX: "mexican mexicano", FR: "french frances", DE: "german alemao alema", GB: "british britanico",
  JP: "japanese japones", SY: "syrian sirio", LB: "lebanese libanes", TR: "turkish turco", SA: "saudi saudita", YE: "houthi houthis", KP: "north korean norte coreano",
  US: "trump biden", AF: "taliban afghan afegao" };
const NAMES = [];   // [nome, iso2, peso]
const add = (n, iso2, w) => { n = norm(n).trim(); if (n.length >= (CJK.test(n) ? 2 : 4) && !NAMES.some(x => x[0] === n && x[1] === iso2)) NAMES.push([n, iso2, w]); };
for (const [iso2, words] of Object.entries(PLACES)) for (const w of words.split(/\s*,\s*/)) add(w, iso2, 3);
// Nomes de país em português, inglês e, pelo Intl do Node, nos outros idiomas dos veículos.
const REGION = ["es", "fr", "ar", "zh", "hi", "de", "ru", "ja"].map(l => { try { return new Intl.DisplayNames([l], { type: "region" }); } catch { return null; } }).filter(Boolean);
for (const [iso2, pt] of allCountries()) {
  const c = country(iso2);
  for (const n of [pt, c.en, ...(c.aliases || [])]) add(n, iso2, 2);
  for (const dn of REGION) { try { const n = dn.of(iso2); if (n && n !== iso2) add(n, iso2, 2); } catch {} }
}
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
    const i = hasName(t, n);
    if (i >= 0 && (w > bestW || (w === bestW && i < pos))) { bestW = w; pos = i; iso2 = c; }
  }
  if (bestW < 3) for (const [n, c, a] of ADMIN_NAMES) {
    if (t.includes(` ${n} `) && (bestW < 2 || c === iso2)) { iso2 = c; a1 = a; break; }
  }
  let layer = null, best = 0;
  const hits = {};
  for (const [L, re] of LEX) hits[L] = (t.match(new RegExp(re.source, "g")) || []).length;
  for (const [L, re] of LEX_INTL) hits[L] += (t.match(re) || []).length;
  for (const [L, n] of Object.entries(hits)) if (n > best) { best = n; layer = L; }
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

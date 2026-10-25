// ACLED — conflito e protesto, com atualização semanal.
// A API mudou em 2025 para login com token (OAuth). Confira o endpoint e os termos de uso:
// a redistribuição de dados do ACLED é restrita, por isso a fonte nasce bloqueada pela trava de licença.
import { http, httpJson } from "../lib/util.js";
import { countryAt, countryByName, countryByNum, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";
import { capPerCountry, countryCondition, deathScale } from "../lib/aggregate.js";

const TOKEN_URL = "https://acleddata.com/oauth/token";
const ymd = ms => new Date(ms).toISOString().slice(0, 10);

/** event_type / sub_event_type do ACLED -> camada e subtipo do Polarized. null = ignorar. */
export function mapAcled(type, sub) {
  if (type === "Battles") return ["conflito", "confronto_armado"];
  if (type === "Explosions/Remote violence") return ["conflito", /air|drone/i.test(sub) ? "ataque_aereo" : "bombardeio"];
  if (type === "Violence against civilians") return ["conflito", "violencia_armada"];
  if (type === "Protests") return ["protesto", /intervention|excessive force/i.test(sub) ? "repressao" : "manifestacao"];
  if (type === "Riots") return ["protesto", "tumulto"];
  return null;
}

export default {
  id: "acled",
  fixture: "acled.json",
  needs: ["ACLED_USERNAME", "ACLED_PASSWORD"],
  async fetch(ctx) {
    const tok = await (await http(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: process.env.ACLED_USERNAME, password: process.env.ACLED_PASSWORD, grant_type: "password", client_id: "acled" }) })).json();
    const to = Date.parse(ctx.now), from = to - ctx.policy.events.acledWindowDays * 864e5;
    const url = `${ctx.source.endpoint}?_format=json&event_date=${ymd(from)}|${ymd(to)}&event_date_where=BETWEEN&limit=10000`;
    return httpJson(url, { headers: { authorization: `Bearer ${tok.access_token}` }, timeoutMs: 90000 });
  },
  normalize(raw, ctx) {
    const P = ctx.policy.events, now = ctx.now;
    const events = [], conflict = new Map(), protest = new Map();
    for (const r of raw.data || []) {
      const m = mapAcled(r.event_type, r.sub_event_type);
      if (!m) continue;
      const lat = Number(r.latitude), lon = Number(r.longitude);
      const c = countryByNum(r.iso) || countryByName(r.country) || countryAt(lat, lon);
      if (!c) continue;
      const deaths = Number(r.fatalities) || 0;
      const [layer, subtype] = m;
      events.push(entity({
        id: `acled:evt:${r.event_id_cnty}`, kind: "event", layer, subtype,
        geo: point(lat, lon), place: placeOf(c, r.admin1 || null),
        start: `${r.event_date}T00:00:00Z`, observedAt: r.timestamp ? Number(r.timestamp) * 1000 : now, precision: "day",
        intensity: layer === "conflito" ? deathScale(deaths) : Math.min(5, 2 + (deaths > 0 ? 2 : 0) + (subtype === "repressao" ? 1 : 0)),
        basis: layer === "conflito" ? "mortes registradas: 1 a 9 → 2, 10 a 99 → 3, 100 a 999 → 4, mil ou mais → 5" : "2, +2 se houve mortes, +1 se houve repressão",
        status: "corroborado", confidence: 0.75,
        sourceId: "acled", ref: r.event_id_cnty, url: "https://acleddata.com/", retrievedAt: now,
        headline: `${{ confronto_armado: "Confronto armado", ataque_aereo: "Ataque aéreo ou com drone", bombardeio: "Bombardeio", violencia_armada: "Violência contra civis", manifestacao: "Protesto", repressao: "Protesto reprimido", tumulto: "Tumulto" }[subtype]} — ${r.location || r.admin1 || c.pt}`.slice(0, 140),
        summary: `${[r.actor1, r.actor2].filter(Boolean).join(" × ")}. ${deaths ? deaths + " mortes registradas." : "Sem mortes registradas."} Fonte original citada pelo ACLED: ${r.source || "não informada"}.`.slice(0, 320),
        body: r.notes ? `Descrição original (inglês): ${r.notes}` : undefined,
        parentId: `acled:cond:${c.iso2.toLowerCase()}-${layer === "conflito" ? "conflito" : "protestos"}`,
      }));
      const bucket = layer === "conflito" ? conflict : protest;
      const a = bucket.get(c.iso2) || { n: 0, deaths: 0, first: r.event_date, repress: 0 };
      a.n++; a.deaths += deaths; if (subtype === "repressao") a.repress++; if (r.event_date < a.first) a.first = r.event_date;
      bucket.set(c.iso2, a);
    }
    const conditions = [];
    for (const [iso2, a] of conflict) {
      if (a.n < 3 && a.deaths < 10) continue;
      conditions.push(...countryCondition({
        sourceId: "acled", iso2, layer: "conflito", subtype: "confronto_armado", id: `acled:cond:${iso2.toLowerCase()}-conflito`, start: `${a.first}T00:00:00Z`, now,
        intensity: deathScale(a.deaths), basis: `soma das mortes registradas nos últimos ${P.acledWindowDays} dias`, status: "corroborado", confidence: 0.75,
        headline: c => `Conflito armado ativo — ${c.pt}`,
        summary: c => `${a.n} eventos de conflito e ${a.deaths} mortes registrados em ${c.pt} nos últimos ${P.acledWindowDays} dias, segundo o ACLED.`,
        url: "https://acleddata.com/", clusterKey: `conflito:${iso2}`,
        metric: `mortes_${P.acledWindowDays}d`, unit: "pessoas", value: a.deaths, method: "ACLED, soma das mortes registradas",
      }));
    }
    for (const [iso2, a] of protest) {
      if (a.n < P.protestConditionMin) continue;
      conditions.push(...countryCondition({
        sourceId: "acled", iso2, layer: "protesto", subtype: a.repress >= a.n / 4 ? "repressao" : "manifestacao", id: `acled:cond:${iso2.toLowerCase()}-protestos`,
        start: `${a.first}T00:00:00Z`, now, intensity: Math.min(5, 2 + Math.floor(Math.log10(a.n)) + (a.repress ? 1 : 0)),
        basis: "2 + log10 do número de protestos, +1 se houve repressão", status: "corroborado", confidence: 0.75,
        headline: c => `Onda de protestos — ${c.pt}`,
        summary: c => `${a.n} protestos e tumultos registrados em ${c.pt} nos últimos ${P.acledWindowDays} dias${a.repress ? `, ${a.repress} com intervenção ou repressão` : ""}.`,
        url: "https://acleddata.com/", clusterKey: `protesto:${iso2}`,
        metric: `protestos_${P.acledWindowDays}d`, unit: "eventos", value: a.n, method: "ACLED",
      }));
    }
    const ids = new Set(conditions.map(e => e.id));
    for (const e of events) if (!ids.has(e.parentId)) delete e.parentId;
    return { entities: [...conditions, ...capPerCountry(events, P.maxEventsPerCountry)] };
  },
};

// Calendário eleitoral mantido pelo projeto (data/curated/elections.json).
// Cada eleição vira uma condição durante a campanha e um evento no dia da votação.
import { readJson, rel, iso } from "../lib/util.js";
import { country, placeOf, point } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

const LABEL = { presidencial: "Eleição presidencial", legislativa: "Eleições legislativas", referendo: "Referendo", segundo_turno: "Segundo turno" };

export default {
  id: "eleicoes",
  fixture: "elections.json",
  async fetch() { return readJson(rel("data/curated/elections.json")); },
  normalize(raw, ctx) {
    const now = Date.parse(ctx.now), out = [];
    for (const el of raw.elections || []) {
      const c = country(el.country);
      if (!c) continue;
      const day = Date.parse(`${el.date}T12:00:00Z`), campaign = day - (el.campaignDays || 45) * 864e5;
      if (now < campaign || now > day + 3 * 864e5) continue;
      const days = Math.ceil((day - now) / 864e5);
      const label = el.title || `${LABEL[el.type] || "Eleição"} — ${c.pt}`;
      const verified = Boolean(el.verifiedAt);
      const base = { place: placeOf(c), geo: point(c.lat, c.lon), sourceId: "curadoria", retrievedAt: ctx.now, url: el.sourceUrl,
        status: verified ? "verificado" : "nao_verificado", confidence: verified ? 0.95 : 0.7,
        links: el.sourceUrl ? [{ label: "Calendário oficial", url: el.sourceUrl }] : [] };
      const condId = `curadoria:cond:${c.iso2.toLowerCase()}-${el.type}-${el.date}`;
      out.push(entity({ ...base, id: condId, kind: "condition", layer: "eleicao", subtype: el.type,
        start: campaign, observedAt: ctx.now, precision: "day",
        intensity: Math.min(5, (days <= 7 ? 4 : days <= 30 ? 3 : 2) + (el.type === "presidencial" ? 1 : 0)),
        basis: "dias até a votação (até 7 → 4, até 30 → 3, mais → 2), +1 se presidencial",
        headline: label, summary: days > 0 ? `Votação em ${days} dia${days > 1 ? "s" : ""}, ${new Date(day).toLocaleDateString("pt-BR", { timeZone: "UTC" })}.` : "Votação realizada; acompanhe a apuração oficial.",
        body: el.note, ref: `${el.country}-${el.date}`, clusterKey: `eleicao:${c.iso2}:${el.date}` }));
      if (Math.abs(day - now) <= 7 * 864e5) out.push(entity({ ...base, id: `curadoria:evt:${c.iso2.toLowerCase()}-${el.date}-votacao`, kind: "event",
        layer: "eleicao", subtype: "dia_de_votacao", start: `${el.date}T00:00:00Z`, observedAt: ctx.now, precision: "day",
        intensity: 4, basis: "dia de votação", headline: `Dia de votação — ${c.pt}`, summary: label, ref: `${el.country}-${el.date}-dia`, parentId: condId }));
    }
    return out;
  },
};

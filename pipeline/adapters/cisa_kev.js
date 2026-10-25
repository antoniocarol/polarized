// CISA KEV — vulnerabilidades com exploração confirmada. Domínio público, sem chave.
import { httpJson } from "../lib/util.js";
import { GLOBAL_PLACE } from "../lib/geo.js";
import { entity } from "../lib/entity.js";

export default {
  id: "cisa_kev",
  fixture: "cisa_kev.json",
  async fetch(ctx) { return httpJson(ctx.source.endpoint, { timeoutMs: 45000 }); },
  normalize(raw, ctx) {
    const since = Date.parse(ctx.now) - ctx.policy.events.kevWindowDays * 864e5;
    const released = raw.dateReleased || ctx.now;
    return (raw.vulnerabilities || [])
      .filter(v => Date.parse(v.dateAdded) >= since)
      .map(v => {
        const ransomware = String(v.knownRansomwareCampaignUse).toLowerCase() === "known";
        return entity({
          id: `cisa_kev:evt:${v.cveID}`, kind: "event", layer: "ciber",
          subtype: ransomware ? "ransomware" : "vulnerabilidade_explorada",
          geo: null, place: GLOBAL_PLACE,
          start: `${v.dateAdded}T00:00:00Z`, observedAt: released, precision: "day",
          intensity: ransomware ? 4 : 3, basis: "3 para exploração confirmada, 4 se usada em campanha de ransomware",
          status: "verificado", confidence: 0.95,
          sourceId: "cisa_kev", ref: v.cveID, url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`, retrievedAt: ctx.now,
          headline: `Falha explorada: ${v.vendorProject} ${v.product}`,
          summary: `${v.cveID} — exploração ativa confirmada pela CISA${ransomware ? ", com uso conhecido em ransomware" : ""}. ` +
            `Prazo de correção para órgãos federais dos EUA: ${v.dueDate}.`,
          body: `Descrição original (inglês): ${v.shortDescription}\nAção exigida: ${v.requiredAction}`,
          tags: ["sem-local", ransomware ? "ransomware" : null].filter(Boolean),
          links: [{ label: `${v.cveID} no NVD`, url: `https://nvd.nist.gov/vuln/detail/${v.cveID}` }],
        });
      });
  },
};

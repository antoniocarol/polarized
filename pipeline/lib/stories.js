// Agrupa relatos sobre o mesmo fato em histórias e liga relatos a acontecimentos.
import crypto from "node:crypto";

const STOP = new Set(("the and for with from that this after over into amid says said will have has were been about their than what when your " +
  "para com uma que dos das nos nas pelo pela sobre apos entre mais diz disse como foram sera seus suas este esta isso essa novo nova").split(" "));
const tokens = s => new Set(String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w)));
const jacc = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n || 1); };

/** Define storyKey: mesmo país (ou ambos sem país), até 36 h de distância e tópico parecido. */
export function clusterStories(reports, { threshold = 0.3, hours = 36 } = {}) {
  const stories = [];
  for (const r of [...reports].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    const tk = tokens(r.topic || r.title);
    const iso2 = r.place?.iso2 || null, t = Date.parse(r.publishedAt);
    let best = null, bs = 0;
    for (const s of stories) {
      if (s.iso2 !== iso2 || Math.abs(t - s.t) > hours * 3600e3) continue;
      const v = jacc(tk, s.tk);
      if (v > bs) { bs = v; best = s; }
    }
    if (best && bs >= threshold) { r.storyKey = best.key; for (const w of tk) if (best.n < 3) best.tk.add(w); best.n++; }
    else { const key = `st-${crypto.createHash("sha1").update(r.id).digest("hex").slice(0, 10)}`; r.storyKey = key; stories.push({ key, iso2, t, tk, n: 1 }); }
  }
  return reports;
}

/** Liga cada relato a até 2 acontecimentos do mesmo país e camada (eventos até 3 dias antes ou depois). */
export function attachReports(reports, entities) {
  const by = new Map();
  for (const e of entities) {
    if ((e.kind !== "condition" && e.kind !== "event") || !e.place?.iso2) continue;
    const k = `${e.place.iso2}|${e.layer}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  for (const r of reports) {
    if (!r.place?.iso2 || !r.layer) continue;
    const t = Date.parse(r.publishedAt);
    const cands = (by.get(`${r.place.iso2}|${r.layer}`) || [])
      .filter(e => e.kind === "condition" || Math.abs(Date.parse(e.time.start) - t) < 3 * 864e5)
      .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0)).slice(0, 2);
    r.relatedIds = cands.map(e => e.id);
    for (const e of cands) { e.reportIds ||= []; if (e.reportIds.length < 12 && !e.reportIds.includes(r.id)) e.reportIds.push(r.id); }
  }
}

import { SCHEMA_VERSION, minutesBetween } from "./util.js";
import { inBox } from "./geo.js";

/**
 * Junta observações desta execução ao histórico (estado privado) e devolve
 * { state, published }: o estado guarda tudo; o publicado aplica a política de atraso.
 */
export function mergeTracks(prevState, observations, { now, policy }) {
  const P = policy.militaryTracks;
  const tracks = new Map((prevState?.tracks || []).map(t => [t.id, structuredClone(t)]));
  for (const o of observations) {
    let t = tracks.get(o.id);
    if (!t) {
      t = { id: o.id, schemaVersion: SCHEMA_VERSION, kind: "track", layer: "militar", subtype: o.subtype,
        asset: o.asset, classification: o.classification, samples: [], firstSeen: o.sample.t, lastSeen: o.sample.t,
        trackStatus: "live", sampleRateSec: o.sampleRateSec, releaseDelayMinutes: 0, status: "nao_verificado",
        sources: [{ sourceId: o.sourceId, retrievedAt: now }], updatedAt: now };
      tracks.set(o.id, t);
    }
    for (const [k, v] of Object.entries(o.asset)) if (v != null) t.asset[k] = v;
    if (o.classification.confidence > t.classification.confidence) t.classification = o.classification;
    if (!t.samples.some(s => s.t === o.sample.t)) t.samples.push(o.sample);
    t.sources[0].retrievedAt = now;
  }
  const state = [], published = [];
  for (const t of tracks.values()) {
    t.schemaVersion = SCHEMA_VERSION;
    t.samples = t.samples.filter(s => minutesBetween(s.t, now) <= P.historyHours * 60).sort((a, b) => a.t.localeCompare(b.t));
    if (!t.samples.length) continue;
    t.firstSeen = t.samples[0].t;
    t.lastSeen = t.samples.at(-1).t;
    const age = minutesBetween(t.lastSeen, now);
    t.trackStatus = age < P.staleAfterMinutes ? "live" : age < P.lostAfterMinutes ? "stale" : "lost";
    t.updatedAt = now;
    state.push(t);

    // Atraso de publicação: amostra dentro de zona com atraso só sai depois do prazo.
    let maxDelay = P.defaultDelayMinutes;
    const visible = t.samples.filter(s => {
      const zone = P.zones.find(z => inBox(s.lat, s.lon, z.bbox));
      const delay = zone ? zone.delayMinutes : P.defaultDelayMinutes;
      if (zone) maxDelay = Math.max(maxDelay, delay);
      return minutesBetween(s.t, now) >= delay;
    });
    if (!visible.length) continue;
    const pub = { ...t, samples: visible, firstSeen: visible[0].t, lastSeen: visible.at(-1).t, releaseDelayMinutes: maxDelay };
    // Status descreve se a fonte ainda recebe o sinal, descontado o atraso imposto.
    const eff = minutesBetween(pub.lastSeen, now) - maxDelay;
    pub.trackStatus = eff < P.staleAfterMinutes ? "live" : eff < P.lostAfterMinutes ? "stale" : "lost";
    published.push(pub);
  }
  return { state, published, militaryMmsi: state.filter(t => t.asset.mmsi).map(t => t.asset.mmsi) };
}

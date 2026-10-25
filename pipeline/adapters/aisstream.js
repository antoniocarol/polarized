// AISStream — posições AIS por WebSocket (chave gratuita em aisstream.io).
// O adaptador escuta por alguns segundos, guarda só navios com indício militar e fecha.
import { iso, round } from "../lib/util.js";
import { classifyVessel } from "../lib/military.js";

const LISTEN_SECONDS = Number(process.env.AIS_LISTEN_SECONDS || 45);
const aisTime = s => (s ? iso(String(s).slice(0, 19).replace(" ", "T") + "Z") : null);

export default {
  id: "aisstream",
  fixture: "aisstream.json",
  needs: ["AISSTREAM_API_KEY"],
  async fetch(ctx) {
    const known = new Set(ctx.state.militaryMmsi || []);
    const kept = [];
    const ws = new WebSocket(ctx.source.endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => ws.close(), LISTEN_SECONDS * 1000);
      ws.onopen = () => ws.send(JSON.stringify({
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      }));
      ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
        const mmsi = String(m.MetaData?.MMSI ?? "");
        const type = m.Message?.ShipStaticData?.Type;
        if (known.has(mmsi) || classifyVessel(type, m.MetaData?.ShipName)) { kept.push(m); known.add(mmsi); }
      };
      ws.onerror = e => { clearTimeout(timer); reject(new Error(`websocket: ${e.message || "erro de conexão"}`)); };
      ws.onclose = () => { clearTimeout(timer); resolve(); };
    });
    return kept;
  },
  normalize(raw, ctx) {
    const statics = new Map(), observations = [];
    for (const m of raw) if (m.MessageType === "ShipStaticData") statics.set(String(m.MetaData.MMSI), m.Message.ShipStaticData);
    const known = new Set(ctx.state.militaryMmsi || []);
    for (const m of raw) {
      if (m.MessageType !== "PositionReport") continue;
      const md = m.MetaData, pr = m.Message.PositionReport, mmsi = String(md.MMSI);
      const st = statics.get(mmsi);
      const name = (st?.Name || md.ShipName || "").trim() || null;
      const cls = classifyVessel(st?.Type, name) ||
        (known.has(mmsi) ? { military: true, rule: "classificado em execução anterior", confidence: 0.7, operator: null, flag: null } : null);
      if (!cls) continue;
      const heading = pr.TrueHeading != null && pr.TrueHeading < 360 ? pr.TrueHeading : pr.Cog;
      observations.push({
        id: `aisstream:trk:${mmsi}`, subtype: "navio", sourceId: "aisstream",
        asset: { callsign: st?.CallSign?.trim() || null, name, icao24: null, mmsi, imo: st?.ImoNumber ? String(st.ImoNumber) : null,
          model: null, class: null, operator: cls.operator, flag: cls.flag },
        classification: { military: true, rule: cls.rule, confidence: cls.confidence },
        sample: { t: aisTime(md.time_utc) || ctx.now, lat: round(pr.Latitude ?? md.latitude, 4), lon: round(pr.Longitude ?? md.longitude, 4),
          altM: null, speedKn: pr.Sog == null ? null : round(pr.Sog, 1), headingDeg: heading == null || heading >= 360 ? null : round(heading, 0) },
        sampleRateSec: 180,
      });
    }
    return { observations };
  },
};

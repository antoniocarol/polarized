// OpenSky Network — vetores de estado ADS-B.
// Doc: https://openskynetwork.github.io/opensky-api/rest.html
// Contas novas usam OAuth2 (client credentials). Sem credencial, roda anônimo com limite diário baixo.
import { http, httpJson, iso, round } from "../lib/util.js";
import { classifyAircraft } from "../lib/military.js";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

async function token() {
  const id = process.env.OPENSKY_CLIENT_ID, secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await http(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  return (await res.json()).access_token;
}

export default {
  id: "opensky",
  fixture: "opensky.json",
  optionalCredentials: true,
  async fetch(ctx) {
    const t = await token();
    return httpJson(ctx.source.endpoint, { headers: t ? { authorization: `Bearer ${t}` } : {}, timeoutMs: 45000 });
  },
  normalize(raw) {
    const observations = [];
    for (const s of raw.states || []) {
      const [icao24, callsign, , timePos, lastContact, lon, lat, baroAlt, onGround, velocity, track, , , geoAlt] = s;
      if (onGround || lat == null || lon == null) continue;
      const cls = classifyAircraft(icao24, callsign);
      if (!cls) continue;
      observations.push({
        id: `opensky:trk:${icao24}`, subtype: "aeronave", sourceId: "opensky",
        asset: { callsign: callsign?.trim() || null, name: null, icao24, mmsi: null, imo: null, model: null,
          class: cls.class || null, operator: cls.operator, flag: cls.flag },
        classification: { military: true, rule: cls.rule, confidence: cls.confidence },
        sample: { t: iso((timePos || lastContact) * 1000), lat: round(lat, 4), lon: round(lon, 4),
          altM: baroAlt ?? geoAlt ?? null, speedKn: velocity == null ? null : round(velocity * 1.94384, 0),
          headingDeg: track == null ? null : round(track, 0) },
        sampleRateSec: 600,
      });
    }
    return { observations };
  },
};

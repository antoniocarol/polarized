import { readJson, rel } from "./util.js";

const M = readJson(rel("pipeline/data/military.json"));
const RANGES = M.icao24Ranges.map(r => ({ ...r, lo: parseInt(r.from, 16), hi: parseInt(r.to, 16) }));
const PREFIXES = M.callsignPrefixes.map(p => ({ ...p, re: new RegExp(`^${p.prefix}\\d`) }));

/** Classifica uma aeronave pelo endereço ICAO e pelo indicativo. null = sem indício militar. */
export function classifyAircraft(icao24, callsign) {
  const cs = String(callsign || "").trim().toUpperCase();
  const p = PREFIXES.find(x => x.re.test(cs));
  if (p) return { military: true, rule: `indicativo ${p.prefix}*`, confidence: p.confidence, operator: p.operator, flag: p.flag, class: p.class };
  const hex = parseInt(icao24, 16);
  const r = RANGES.find(x => hex >= x.lo && hex <= x.hi);
  if (r) return { military: true, rule: `icao24 ${r.from}–${r.to}`, confidence: r.confidence, operator: r.operator, flag: r.flag, class: null };
  return null;
}

/** Classifica um navio pelo tipo AIS e pelo prefixo do nome. */
export function classifyVessel(shipType, name) {
  const t = M.aisShipTypes.find(x => x.type === shipType);
  if (t) return { military: true, rule: `tipo AIS ${t.type} (${t.label})`, confidence: t.confidence, operator: null, flag: null };
  const n = String(name || "").toUpperCase();
  const p = M.vesselNamePrefixes.find(x => n.startsWith(x.prefix));
  if (p) return { military: true, rule: `nome "${p.prefix.trim()}…"`, confidence: p.confidence, operator: p.operator, flag: p.flag };
  return null;
}

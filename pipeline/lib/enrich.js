// Completa o estado (admin-1) de eventos com ponto e dá posição aos relatos com estado conhecido.
import { admin1At, admin1List } from "./geo.js";

export function enrichAdmin1(entities) {
  let n = 0;
  for (const e of entities) {
    if (e.kind === "event" && e.geo?.type === "Point" && e.place?.iso2 && !e.place.admin1Code) {
      const [lon, lat] = e.geo.coordinates;
      const a = admin1At(lat, lon, e.place.iso2);
      if (a) { e.place.admin1 = a.name; if (a.code) e.place.admin1Code = a.code; n++; }
    }
    if (e.kind === "report" && e.place?.admin1Code && !e.geo) {
      const a = admin1List(e.place.iso2).find(x => x.code === e.place.admin1Code);
      if (a) e.geo = { type: "Point", coordinates: [a.lon, a.lat] };
    }
  }
  return n;
}

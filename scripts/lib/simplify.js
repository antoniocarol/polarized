/** Douglas-Peucker em [lon, lat][]; mantém o primeiro e o último ponto. */
export function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = n ? Math.abs(dx * (ay - py) - (ax - px) * dy) / n : Math.hypot(px - ax, py - ay);
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export const flat = (pts, dec) => pts.flatMap(([x, y]) => [+x.toFixed(dec), +y.toFixed(dec)]);
export function bboxOf(pts) {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of pts) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

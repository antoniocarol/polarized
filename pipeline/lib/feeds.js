// Leitura mínima de RSS 2.0, RDF e Atom. Guarda só manchete, link, data e o resumo do próprio feed.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, " ")      // HTML que vinha escapado como &lt;p&gt;
    .replace(/\s+/g, " ").trim();
}
const tag = (block, names) => {
  for (const n of names) {
    const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m) return m[1];
  }
  return null;
};
export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    let link = decode(tag(b, ["link"]));
    if (!link) link = (/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(b) || /<link\b[^>]*href="([^"]+)"/i.exec(b) || [])[1] || "";
    if (!link) link = decode(tag(b, ["guid"]));
    const title = decode(tag(b, ["title"]));
    const date = decode(tag(b, ["pubDate", "dc:date", "published", "updated"]));
    const description = decode(tag(b, ["description", "summary"]));
    if (title && /^https?:\/\//.test(link)) items.push({ title, link: link.replace(/&amp;/g, "&"), date, description });
  }
  return items;
}

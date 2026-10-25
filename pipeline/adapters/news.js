// Notícias: feeds RSS de redações, contas de redações no Bluesky e no X.
// Cada manchete vira um "report" — um relato, não um fato confirmado. A classificação
// (país, estado, camada) e o agrupamento em histórias vêm depois, no pipeline.
import crypto from "node:crypto";
import { http, httpJson, iso, SCHEMA_VERSION } from "../lib/util.js";
import { parseFeed } from "../lib/feeds.js";

const WINDOW_H = 48, PER_FEED = 40;
const hash = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 14);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || null);

export function report({ sourceId, outlet, url, title, excerpt, publishedAt, now }) {
  return {
    id: `${sourceId}:rep:${hash(url)}`, schemaVersion: SCHEMA_VERSION, kind: "report", sourceId, outlet: outlet.id,
    url, title: clip(title, 300), excerpt: clip(excerpt, 300), summaryPt: null, lang: outlet.lang || "und",
    publishedAt: iso(publishedAt), place: null, geo: null, layer: null, subtype: null, storyKey: `st-${hash(url).slice(0, 10)}`,
    topic: null, classifiedBy: "fonte", relatedIds: [], status: "nao_verificado", confidence: 0.6,
    sources: [{ sourceId, url, retrievedAt: iso(now) }], updatedAt: iso(now),
  };
}
const fresh = (t, now) => { const ms = Date.parse(t); return Number.isFinite(ms) && Date.parse(now) - ms <= WINDOW_H * 3600e3 && ms <= Date.parse(now) + 3600e3; };
// A mesma matéria aparece repetida num feed, ou em dois feeds; fica o primeiro relato.
const uniq = list => { const seen = new Set(); return list.filter(r => !seen.has(r.id) && seen.add(r.id)); };
const feedsOf = (outlets, kind) => outlets.flatMap(o => o.feeds.filter(f => f.kind === kind).map(f => ({ o, f })));

async function each(list, fn) {
  const raw = {}, warnings = [];
  for (const it of list) { try { raw[it.key] = await fn(it); } catch (e) { warnings.push(`${it.key}: ${e.message}`); } }
  return { raw, warnings };
}

export const rss = {
  id: "rss",
  fixture: "rss.json",
  async fetch(ctx) {
    return each(feedsOf(ctx.outlets, "rss").map(x => ({ ...x, key: x.o.id })), ({ f }) =>
      http(f.url, { timeoutMs: 20000, retries: 1, headers: { "user-agent": "PolarizedBot/0.4 (+https://github.com/antoniocarol/polarized)" } }).then(r => r.text()));
  },
  normalize(res, ctx) {
    const byId = new Map(ctx.outlets.map(o => [o.id, o])), out = [];
    for (const [id, xml] of Object.entries(res.raw || res)) {
      const outlet = byId.get(id); if (!outlet) continue;
      for (const it of parseFeed(xml).filter(i => fresh(i.date, ctx.now)).slice(0, PER_FEED))
        out.push(report({ sourceId: "rss", outlet, url: it.link, title: it.title, excerpt: it.description, publishedAt: it.date, now: ctx.now }));
    }
    return { entities: uniq(out), warnings: res.warnings || [] };
  },
};

export const bluesky = {
  id: "bluesky",
  fixture: "bluesky.json",
  async fetch(ctx) {
    return each(feedsOf(ctx.outlets, "bluesky").map(x => ({ ...x, key: x.f.handle })), ({ f }) =>
      httpJson(`${ctx.source.endpoint}?actor=${encodeURIComponent(f.handle)}&limit=30&filter=posts_no_replies`, { timeoutMs: 20000, retries: 1 }));
  },
  normalize(res, ctx) {
    const out = [];
    for (const { o, f } of feedsOf(ctx.outlets, "bluesky")) {
      for (const item of (res.raw || res)[f.handle]?.feed || []) {
        if (item.reason) continue;                        // repost
        const p = item.post, rec = p.record || {}, ext = p.embed?.external;
        if (!fresh(rec.createdAt, ctx.now)) continue;
        const rkey = String(p.uri).split("/").pop();
        out.push(report({ sourceId: "bluesky", outlet: o, url: ext?.uri || `https://bsky.app/profile/${f.handle}/post/${rkey}`,
          title: ext?.title || rec.text, excerpt: ext?.description || (ext ? rec.text : null), publishedAt: rec.createdAt, now: ctx.now }));
      }
    }
    return { entities: uniq(out), warnings: res.warnings || [] };
  },
};

export const x = {
  id: "x",
  fixture: "x.json",
  needs: ["X_BEARER_TOKEN"],
  async fetch(ctx) {
    const headers = { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` };
    return each(feedsOf(ctx.outlets, "x").map(v => ({ ...v, key: v.f.username })), async ({ f }) => {
      const u = await httpJson(`${ctx.source.endpoint}/users/by/username/${encodeURIComponent(f.username)}`, { headers, retries: 0 });
      const t = await httpJson(`${ctx.source.endpoint}/users/${u.data.id}/tweets?max_results=20&exclude=replies,retweets&tweet.fields=created_at,entities`, { headers, retries: 0 });
      return t;
    });
  },
  normalize(res, ctx) {
    const out = [];
    for (const { o, f } of feedsOf(ctx.outlets, "x")) {
      for (const tw of (res.raw || res)[f.username]?.data || []) {
        if (!fresh(tw.created_at, ctx.now)) continue;
        const link = (tw.entities?.urls || []).map(u => u.unwound_url || u.expanded_url).find(u => u && !/x\.com|twitter\.com/.test(u));
        const text = String(tw.text).replace(/https:\/\/t\.co\/\S+/g, "").trim();
        out.push(report({ sourceId: "x", outlet: o, url: link || `https://x.com/${f.username}/status/${tw.id}`, title: text, excerpt: null, publishedAt: tw.created_at, now: ctx.now }));
      }
    }
    return { entities: uniq(out), warnings: res.warnings || [] };
  },
};

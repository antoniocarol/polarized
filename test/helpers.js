import { readJson, rel } from "../pipeline/lib/util.js";
export const NOW = "2026-10-25T17:00:00Z";
export const policy = readJson(rel("pipeline/policy.json"));
export const registry = Object.fromEntries(readJson(rel("schema/sources.json")).sources.map(s => [s.id, s]));
export const fixture = name => readJson(rel("pipeline/fixtures", name));
export const ctx = (id, extra = {}) => ({ now: NOW, policy, source: registry[id], fixtures: true, state: {}, ...extra });

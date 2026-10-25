import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { apply } from "../scripts/sync-app.js";
import { rel } from "../pipeline/lib/util.js";

test("o app usa a mesma taxonomia, o mesmo prompt e as mesmas guardas do pipeline", () => {
  const html = fs.readFileSync(rel("index.html"), "utf8");
  assert.equal(apply(html), html, "rode npm run sync-app");
});

test("todo glifo da taxonomia existe no app", () => {
  const html = fs.readFileSync(rel("index.html"), "utf8");
  const tax = JSON.parse(fs.readFileSync(rel("schema/taxonomy.json"), "utf8"));
  for (const layer of Object.values(tax.layers)) for (const s of Object.values(layer.subtypes)) {
    assert.ok(html.includes(`"${s.glyph}":"M`), `glifo ${s.glyph} ausente`);
  }
});

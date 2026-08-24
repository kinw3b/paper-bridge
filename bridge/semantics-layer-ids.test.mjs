import test from "node:test";
import assert from "node:assert/strict";
import { enrichLayerIds } from "./semantics.mjs";

function sidecar(rows) {
  const ids = Object.fromEntries(rows.map((row) => [row.pcId, row]));
  return {
    generatedFrom: "url-to-paper/serializer",
    total: rows.length,
    sections: [{ id: "01", slug: "hero", section: "01 · hero", ids: rows.length }],
    ids,
  };
}

test("retags a generic serializer row from the live scan", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.2",
      path: "0.2",
      tag: "div",
      class: "framer-text",
      classes: ["framer-text"],
      text: "Create your workspace",
      section: "01 · hero",
    }]),
    [{ pcId: "pc-01-0.2", path: "0.2", tag: "h1", text: "Create your workspace", sectionId: "01" }],
  );
  assert.equal(result.payload.generatedFrom, "url-to-paper/serializer");
  assert.equal(result.payload.enrichedFrom, "paper-capture-extension");
  assert.equal(result.payload.ids["pc-01-0.2"].tag, "h1");
  assert.equal(result.payload.ids["pc-01-0.2"].sourceTag, "div");
  assert.equal(result.retagged, 1);
});

test("fills href / src the serializer left blank", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.4",
      path: "0.4",
      tag: "a",
      href: "",
      src: "",
      text: "",
      section: "01 · hero",
    }]),
    [{
      pcId: "pc-01-0.4",
      path: "0.4",
      tag: "a",
      href: "https://example.com/pricing",
      text: "Get started",
      sectionId: "01",
    }],
  );
  assert.equal(result.payload.ids["pc-01-0.4"].href, "https://example.com/pricing");
  assert.equal(result.payload.ids["pc-01-0.4"].text, "Get started");
  assert.equal(result.payload.ids["pc-01-0.4"].tag, "a");
  assert.equal(result.filled, 1);
  assert.equal(result.retagged, 0);
});

test("promotes a display:contents descendant so 2.2.a can retag a real node", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.2.1.0",
      path: "0.2.1.0",
      tag: "span",
      text: "Create your workspace",
      class: "framer-text",
      section: "01 · hero",
    }]),
    [{ pcId: "pc-01-0.2.1", path: "0.2.1", tag: "h1", text: "Create your workspace", sectionId: "01" }],
  );
  assert.equal(result.payload.ids["pc-01-0.2.1.0"].tag, "h1");
  assert.equal(result.payload.ids["pc-01-0.2.1"], undefined);
  assert.equal(result.promoted, 1);
  assert.equal(result.added, 0);
});

test("adds a missing content row when the serializer dropped it", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0",
      path: "0",
      tag: "section",
      section: "01 · hero",
    }]),
    [{ pcId: "pc-01-0.8", path: "0.8", tag: "img", src: "https://cdn.example/hero.png", alt: "Hero", sectionId: "01", sectionLabel: "hero" }],
  );
  assert.equal(result.payload.ids["pc-01-0.8"].tag, "img");
  assert.equal(result.payload.ids["pc-01-0.8"].src, "https://cdn.example/hero.png");
  assert.equal(result.payload.ids["pc-01-0.8"].section, "01 · hero");
  assert.equal(result.added, 1);
  assert.equal(result.payload.total, 2);
});

test("does not invent a landmark row or overwrite an inner link", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.3.0",
      path: "0.3.0",
      tag: "a",
      href: "/pricing",
      text: "Pricing",
      section: "01 · hero",
    }]),
    [
      { pcId: "pc-01-0.3", path: "0.3", tag: "nav", sectionId: "01" },
      { pcId: "pc-01-0.9", path: "0.9", tag: "section", sectionId: "01" },
    ],
  );
  assert.equal(result.payload.ids["pc-01-0.3.0"].tag, "a");
  assert.equal(result.payload.ids["pc-01-0.9"], undefined);
  assert.equal(result.added, 0);
  assert.equal(result.promoted, 0);
});

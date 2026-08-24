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

test("receipt ids are keyed by scan pcId and applyTo the exact-text parent when dump dropped the leaf", () => {
  const leaf = "pc-06-0.0.1.2.0.0.0.0.0.0.0";
  const wrap = "pc-06-0.0.1.2.0.0.0.0.0.0";
  const card = "pc-06-0.0.1.2.0.0.0.0.0";
  const result = enrichLayerIds(
    sidecar([
      {
        pcId: leaf,
        path: "0.0.1.2.0.0.0.0.0.0.0",
        tag: "h3",
        text: "One of a kind restaurant",
        section: "06 · testimonial-section",
      },
      {
        pcId: wrap,
        path: "0.0.1.2.0.0.0.0.0.0",
        tag: "div",
        text: "One of a kind restaurant",
        section: "06 · testimonial-section",
      },
      {
        pcId: card,
        path: "0.0.1.2.0.0.0.0.0",
        tag: "div",
        text: "One of a kind restaurantThe culinary experience",
        section: "06 · testimonial-section",
      },
    ]),
    [{
      pcId: leaf,
      path: "0.0.1.2.0.0.0.0.0.0.0",
      tag: "h3",
      text: "One of a kind restaurant",
      href: "",
      src: "",
      alt: "",
      sectionId: "06",
    }],
    {
      dumpIds: new Set([wrap, card]),
      paperIds: { [leaf]: "2ZZ-0", [wrap]: "2ZY-0" },
    },
  );
  const row = result.ids[leaf];
  assert.ok(row);
  assert.equal(row.pcId, leaf);
  assert.equal(row.path, "0.0.1.2.0.0.0.0.0.0.0");
  assert.equal(row.tag, "h3");
  assert.equal(row.text, "One of a kind restaurant");
  assert.equal(row.href, "");
  assert.equal(row.src, "");
  assert.equal(row.alt, "");
  assert.equal(row.section, "06 · testimonial-section");
  assert.equal(row.paperId, "2ZZ-0");
  assert.equal(row.applyTo, wrap);
  assert.equal(result.ids[wrap].tag, "div");
  assert.equal(result.ids[wrap].applyTo, wrap);
  assert.equal(result.payload.ids[wrap].tag, "div");
  assert.equal(result.payload.ids[leaf].tag, "h3");
  assert.equal(result.payload.ids[card].tag, "div");
  assert.equal(result.promoted, 0);
  assert.equal(result.validated, 1);
});

test("applyTo stays on the leaf when the dump still has it", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.2",
      path: "0.2",
      tag: "h1",
      text: "Create your workspace",
      section: "01 · hero",
    }]),
    [{ pcId: "pc-01-0.2", path: "0.2", tag: "h1", text: "Create your workspace", sectionId: "01" }],
    { dumpIds: new Set(["pc-01-0.2"]), paperIds: { "pc-01-0.2": "2AA-0" } },
  );
  assert.equal(result.ids["pc-01-0.2"].applyTo, "pc-01-0.2");
  assert.equal(result.ids["pc-01-0.2"].paperId, "2AA-0");
});

test("does not applyTo a parent whose text is not the leaf text", () => {
  const leaf = "pc-06-0.0.1.2.0.0.0.0.0.0.0";
  const wrap = "pc-06-0.0.1.2.0.0.0.0.0.0";
  const result = enrichLayerIds(
    sidecar([
      { pcId: leaf, path: "0.0.1.2.0.0.0.0.0.0.0", tag: "h3", text: "One of a kind restaurant", section: "06 · testimonial-section" },
      { pcId: wrap, path: "0.0.1.2.0.0.0.0.0.0", tag: "div", text: "One of a kind restaurant and the rest of the card", section: "06 · testimonial-section" },
    ]),
    [{ pcId: leaf, path: "0.0.1.2.0.0.0.0.0.0.0", tag: "h3", text: "One of a kind restaurant", sectionId: "06" }],
    { dumpIds: new Set([wrap]) },
  );
  assert.equal(result.ids[leaf].applyTo, leaf);
  assert.equal(result.payload.ids[wrap].tag, "div");
});

test("every scan node with a pcId appears under receipt ids", () => {
  const result = enrichLayerIds(
    sidecar([
      { pcId: "pc-06-0", path: "0", tag: "section", section: "06 · testimonial-section" },
      { pcId: "pc-06-0.1", path: "0.1", tag: "img", src: "/keep.png", section: "06 · testimonial-section" },
    ]),
    [
      { pcId: "pc-06-0.9.1", path: "0.9.1", tag: "h3", text: "Orphan", sectionId: "06" },
      { pcId: "pc-06-0.1.0", path: "0.1.0", tag: "h3", text: "Photo title", sectionId: "06" },
      { pcId: "pc-06-0.1", path: "0.1", tag: "img", src: "/keep.png", alt: "Keep", sectionId: "06" },
    ],
    { dumpIds: new Set(["pc-06-0", "pc-06-0.1"]) },
  );
  assert.equal(result.ids["pc-06-0.9.1"].pcId, "pc-06-0.9.1");
  assert.equal(result.ids["pc-06-0.1.0"].pcId, "pc-06-0.1.0");
  assert.equal(result.ids["pc-06-0.1"].pcId, "pc-06-0.1");
  assert.equal(result.ids["pc-06-0.1"].applyTo, "pc-06-0.1");
  assert.equal(result.payload.ids["pc-06-0"].tag, "section");
  assert.equal(result.payload.ids["pc-06-0.1"].tag, "img");
  assert.equal(result.payload.ids["pc-06-0.9.1"], undefined);
  assert.equal(result.promoted, 0);
  assert.equal(result.ids["pc-06-0"].tag, "section");
});

test("receipt ids include every census row, not only the scan hits", () => {
  const result = enrichLayerIds(
    sidecar([
      { pcId: "pc-01-0.1.0.0.0.0.0.0", path: "0.1.0.0.0.0.0.0", tag: "h1", text: "Best food for", section: "01 · hero" },
      { pcId: "pc-01-0.1.0.0.1.0.0.0", path: "0.1.0.0.1.0.0.0", tag: "p", text: "Discover delectable cuisine", section: "01 · hero" },
      { pcId: "pc-06-0.0.1.0.0.0.0.0.0.0.0", path: "0.0.1.0.0.0.0.0.0.0.0", tag: "h3", text: "The best restaurant", section: "06 · testimonial-section" },
      { pcId: "pc-08-0.0.0.0.0.0.1.0", path: "0.0.0.0.0.0.1.0", tag: "p", text: "In the new era of technology", section: "08 · footer" },
    ]),
    [{
      pcId: "pc-06-0.0.1.0.0.0.0.0.0.0.0",
      path: "0.0.1.0.0.0.0.0.0.0.0",
      tag: "h3",
      text: "The best restaurant",
      sectionId: "06",
    }],
    { dumpIds: new Set(["pc-01-0.1.0.0.0.0.0.0", "pc-01-0.1.0.0.1.0.0.0", "pc-08-0.0.0.0.0.0.1.0"]) },
  );
  assert.equal(Object.keys(result.ids).length, 4);
  assert.equal(result.ids["pc-01-0.1.0.0.0.0.0.0"].tag, "h1");
  assert.equal(result.ids["pc-01-0.1.0.0.1.0.0.0"].tag, "p");
  assert.equal(result.ids["pc-08-0.0.0.0.0.0.1.0"].tag, "p");
  assert.equal(result.ids["pc-06-0.0.1.0.0.0.0.0.0.0.0"].tag, "h3");
});

test("joins a scan node without pcId onto the matching census row", () => {
  const result = enrichLayerIds(
    sidecar([{
      pcId: "pc-01-0.1.0.0.0.0.0.0",
      path: "0.1.0.0.0.0.0.0",
      tag: "h1",
      text: "Best food for",
      href: "",
      section: "01 · hero",
    }]),
    [{ tag: "h1", text: "Best food for", sectionId: "01", sectionLabel: "hero" }],
    { dumpIds: new Set(["pc-01-0.1.0.0.0.0.0.0"]), paperIds: { "pc-01-0.1.0.0.0.0.0.0": "2R9-0" } },
  );
  assert.equal(result.ids["pc-01-0.1.0.0.0.0.0.0"].tag, "h1");
  assert.equal(result.ids["pc-01-0.1.0.0.0.0.0.0"].paperId, "2R9-0");
  assert.equal(result.payload.ids["pc-01-0.1.0.0.0.0.0.0"].tag, "h1");
});

test("applyTo the empty parent wrapper when dump dropped an img leaf", () => {
  const leaf = "pc-03-0.0.0.0.0.0.0.0";
  const wrap = "pc-03-0.0.0.0.0.0.0";
  const result = enrichLayerIds(
    sidecar([
      { pcId: leaf, path: "0.0.0.0.0.0.0.0", tag: "img", src: "https://cdn.example/photo.png", text: "IMG", section: "03 · content-section" },
      { pcId: wrap, path: "0.0.0.0.0.0.0", tag: "div", text: "", section: "03 · content-section" },
    ]),
    [{ pcId: leaf, path: "0.0.0.0.0.0.0.0", tag: "img", src: "https://cdn.example/photo.png", text: "IMG", sectionId: "03" }],
    { dumpIds: new Set([wrap]) },
  );
  assert.equal(result.ids[leaf].applyTo, wrap);
  assert.equal(result.payload.ids[wrap].tag, "div");
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

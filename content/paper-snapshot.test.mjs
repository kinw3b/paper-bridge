import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

function load() {
  const sandbox = { globalThis: {} };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, "paper-snapshot.js"), "utf8"), sandbox);
  const api = sandbox.globalThis.PaperCaptureSnapshot;
  assert.ok(api, "PaperCaptureSnapshot must attach to globalThis");
  return api;
}

test("svgHrefId matches Paper Snapshot fragments and Framer page URLs", () => {
  const { svgHrefId } = load();
  assert.equal(svgHrefId("#svg-1984002905_559"), "svg-1984002905_559");
  assert.equal(svgHrefId("https://kp-dover.framer.website/home-4?x=1#svg-1984002905_559"), "svg-1984002905_559");
  assert.equal(svgHrefId("/icons.svg#arrow"), "arrow");
  assert.equal(svgHrefId("https://example.com/icon.svg"), "");
});

test("pseudo content splits url() and quoted text like Paper Snapshot 0.3.12", () => {
  const { pseudoContentParts } = load();
  const parts = (raw) => JSON.parse(JSON.stringify(pseudoContentParts(raw)));
  assert.deepEqual(parts('"→"'), [{ kind: "text", text: "→" }]);
  assert.deepEqual(parts('url("https://x.test/a.png")'), [{ kind: "url", url: "https://x.test/a.png" }]);
  assert.deepEqual(parts("url(https://x.test/a.png) \"alt\" / \"ignored\""), [
    { kind: "url", url: "https://x.test/a.png" },
    { kind: "text", text: "alt" },
  ]);
  assert.deepEqual(parts("none"), []);
});

test("pseudo markup emits <img> for a lone url() and a div otherwise", () => {
  const { pseudoMarkup } = load();
  assert.equal(
    pseudoMarkup({ content: 'url("https://x.test/a.png")', display: "block", width: "24px" }),
    '<img src="https://x.test/a.png" style="display: block; width: 24px;">',
  );
  assert.equal(
    pseudoMarkup({ content: '"a" url(b.png) "<c>"', display: "inline" }),
    '<div style="display: inline;">a<img src="b.png">&lt;c&gt;</div>',
  );
  assert.equal(
    pseudoMarkup({ content: '""', "font-family": '"Inter", sans-serif' }),
    '<div style="font-family: &quot;Inter&quot;, sans-serif;"></div>',
  );
});

test("pseudo markup wraps mixed content in the requested tag (0.4.4 uses <span> inside <p>)", () => {
  const { pseudoMarkup } = load();
  assert.equal(
    pseudoMarkup({ content: '"•"', display: "inline" }, "span"),
    '<span style="display: inline;">•</span>',
  );
  assert.equal(
    pseudoMarkup({ content: 'url("a.png")', display: "block" }, "span"),
    '<img src="a.png" style="display: block;">',
  );
});

test("nesting scope demotes invalid children like Paper Snapshot 0.4.4", () => {
  const { mustDemote, childScope } = load();
  const root = { inParagraph: false, inAnchor: false, inButton: false };
  const inP = childScope("p", root);
  assert.equal(inP.inParagraph, true);
  assert.equal(mustDemote("div", inP), true);
  assert.equal(mustDemote("h2", inP), true);
  assert.equal(mustDemote("span", inP), false);
  assert.equal(mustDemote("div", root), false);
  const inA = childScope("a", root);
  assert.equal(mustDemote("a", inA), true);
  assert.equal(mustDemote("div", inA), false);
  const inButton = childScope("button", inP);
  assert.equal(inButton.inParagraph, false, "<button> resets the paragraph scope");
  assert.equal(mustDemote("div", inButton), false);
  assert.equal(mustDemote("button", inButton), true);
  assert.equal(childScope("span", inA), inA, "other tags pass the scope through");
});

function loadWith(globals) {
  const sandbox = { globalThis: {}, ...globals };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  Object.assign(sandbox.globalThis, globals);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, "paper-snapshot.js"), "utf8"), sandbox);
  return sandbox.globalThis.PaperCaptureSnapshot;
}

test("empty colspan>1 table cells pad with table-cell siblings like Paper Snapshot 0.4.10", () => {
  class HTMLTableCellElement {
    constructor(tagName, colSpan) { this.tagName = tagName; this.colSpan = colSpan; }
  }
  const { colspanPadding } = loadWith({ HTMLTableCellElement });
  const pad = '<div paper-snapshot-original-tag="TD" style="display: table-cell;"></div>';
  assert.equal(colspanPadding(new HTMLTableCellElement("TD", 3), { display: "table-cell" }, ""), pad + pad);
  assert.equal(
    colspanPadding(new HTMLTableCellElement("TH", 2), { display: "table-cell" }, ""),
    '<div paper-snapshot-original-tag="TH" style="display: table-cell;"></div>',
  );
  // Filled cells, single-column cells, and restyled cells get no padding.
  assert.equal(colspanPadding(new HTMLTableCellElement("TD", 3), { display: "table-cell" }, "x"), "");
  assert.equal(colspanPadding(new HTMLTableCellElement("TD", 1), { display: "table-cell" }, ""), "");
  assert.equal(colspanPadding(new HTMLTableCellElement("TD", 3), { display: "block" }, ""), "");
  assert.equal(colspanPadding({ tagName: "DIV", colSpan: 3 }, { display: "table-cell" }, ""), "");
});

test("Elementor .elementor-invisible is lifted for capture and restored unless animated (0.4.10)", () => {
  const { liftElementorInvisible } = loadWith({});
  const el = (classes) => {
    const set = new Set(classes);
    return {
      set,
      classList: {
        remove: (c) => set.delete(c),
        add: (c) => set.add(c),
        contains: (c) => set.has(c),
      },
    };
  };
  const stillHidden = el(["elementor-invisible"]);
  const animatedIn = el(["elementor-invisible"]);
  const root = { querySelectorAll: (sel) => (sel === ".elementor-invisible" ? [stillHidden, animatedIn] : []) };
  const restore = liftElementorInvisible(root);
  assert.equal(stillHidden.set.has("elementor-invisible"), false);
  assert.equal(animatedIn.set.has("elementor-invisible"), false);
  animatedIn.set.add("animated");
  restore();
  assert.equal(stillHidden.set.has("elementor-invisible"), true);
  assert.equal(animatedIn.set.has("elementor-invisible"), false);
});

test("style probe is shadow-rooted and text-align resets only on the root (0.4.10)", () => {
  const src = fs.readFileSync(path.join(dir, "paper-snapshot.js"), "utf8");
  assert.match(src, /createElement\("x-paper-style-reference"\)/);
  assert.match(src, /attachShadow\(\{ mode: "open" \}\)\.append\(probe\)/);
  assert.match(src, /setProperty\("all", "inherit", "important"\)/);
  const rootBlock = src.slice(src.indexOf("    if (isRoot) {\n      probe.style.color"), src.indexOf("if (!attachProbe(element, host))"));
  assert.match(rootBlock, /text-align/);
  assert.equal((src.match(/"text-align", "initial"/g) || []).length, 1);
});

test("svg root with visible overflow emits overflow-x/overflow-y explicitly (0.4.13)", () => {
  class SVGElement {}
  class SVGSVGElement extends SVGElement {}
  class SVGCircleElement extends SVGElement {}
  const { svgRootOverflow } = loadWith({ SVGElement, SVGSVGElement });
  const computed = (values) => ({ getPropertyValue: (name) => values[name] ?? "" });
  const plain = (o) => JSON.parse(JSON.stringify(o));

  const visible = {};
  svgRootOverflow(new SVGSVGElement(), computed({ "overflow-x": "visible", "overflow-y": "visible" }), visible);
  assert.deepEqual(plain(visible), { "overflow-x": "visible", "overflow-y": "visible" });

  const overrides = { "overflow-x": "hidden", width: "20px" };
  svgRootOverflow(new SVGSVGElement(), computed({ "overflow-x": "visible", "overflow-y": "hidden" }), overrides);
  assert.deepEqual(plain(overrides), { "overflow-x": "visible", width: "20px" });

  const clipped = {};
  svgRootOverflow(new SVGSVGElement(), computed({ "overflow-x": "hidden", "overflow-y": "hidden" }), clipped);
  assert.deepEqual(plain(clipped), {});

  const shape = {};
  svgRootOverflow(new SVGCircleElement(), computed({ "overflow-x": "visible", "overflow-y": "visible" }), shape);
  assert.deepEqual(plain(shape), {});
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "serialize-css.js");

function load() {
  const sandbox = { globalThis: {} };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox);
  const api = sandbox.globalThis.PaperCaptureSerializeCss;
  assert.ok(api, "PaperCaptureSerializeCss must attach to globalThis");
  return api;
}

function computed(map) {
  return { getPropertyValue: (name) => (map[name] == null ? "" : String(map[name])) };
}

test("emits a Paper border shorthand when all four edges match", () => {
  const { paintDeclarations } = load();
  const decls = paintDeclarations(computed({
    "border-top-width": "1px",
    "border-right-width": "1px",
    "border-bottom-width": "1px",
    "border-left-width": "1px",
    "border-top-style": "solid",
    "border-right-style": "solid",
    "border-bottom-style": "solid",
    "border-left-style": "solid",
    "border-top-color": "rgb(17, 17, 17)",
    "border-right-color": "rgb(17, 17, 17)",
    "border-bottom-color": "rgb(17, 17, 17)",
    "border-left-color": "rgb(17, 17, 17)",
  }));
  assert.equal(decls.join(";"), "border:1px solid rgb(17, 17, 17)");
});

test("emits inset when an absolute fill pins all four sides", () => {
  const { layoutDeclarations } = load();
  const decls = layoutDeclarations(computed({
    top: "0px",
    right: "0px",
    bottom: "0px",
    left: "0px",
    "z-index": "1",
  }));
  assert.equal(decls[0], "inset:0px");
  assert.equal(decls[1], "z-index:1");
});

test("freeze motion CSS disables transitions and animations on the live page", () => {
  const { freezeMotionStyleText } = load();
  const css = freezeMotionStyleText();
  assert.match(css, /data-paper-capture-freeze/);
  assert.match(css, /transition:\s*none\s*!important/);
  assert.match(css, /animation:\s*none\s*!important/);
});

test("paint rest requires identical snapshots, not a mid-tween transform", () => {
  const { isPaintRest } = load();
  assert.equal(isPaintRest("matrix(0.4, 0, 0, 0.4, 0, 0)|1", "matrix(1, 0, 0, 1, 0, 0)|1", 5), false);
  assert.equal(isPaintRest("matrix(1, 0, 0, 1, 0, 0)|1", "matrix(1, 0, 0, 1, 0, 0)|1", 1), false);
  assert.equal(isPaintRest("matrix(1, 0, 0, 1, 0, 0)|1", "matrix(1, 0, 0, 1, 0, 0)|1", 2), true);
});

test("turns a 0-offset ring box-shadow into a Paper border", () => {
  const { splitRingShadows } = load();
  const result = splitRingShadows("rgb(12, 21, 35) 0px 0px 0px 1px");
  assert.equal(result.border, "1px solid rgb(12, 21, 35)");
  assert.equal(result.boxShadow, "");
});

test("keeps a real drop shadow as box-shadow", () => {
  const { splitRingShadows } = load();
  const result = splitRingShadows("rgba(0, 0, 0, 0.12) 0px 8px 24px 0px");
  assert.equal(result.border, "");
  assert.equal(result.boxShadow, "rgba(0, 0, 0, 0.12) 0px 8px 24px 0px");
});

test("promotes an absolute covering fill and drops a scaled-away overlay", () => {
  const { shouldPromoteFill, shouldDropPaintLayer } = load();
  const fill = {
    position: "absolute",
    opacity: "1",
    transform: "none",
    backgroundColor: "rgb(12, 30, 27)",
    backgroundImage: "none",
    hasText: false,
    hasMedia: false,
    coversParent: true,
  };
  assert.equal(shouldPromoteFill(fill), true);
  assert.equal(shouldDropPaintLayer({ ...fill, opacity: "0" }), true);
  assert.equal(shouldPromoteFill({ ...fill, hasText: true }), false);
  assert.equal(shouldPromoteFill({
    ...fill,
    transform: "matrix(0.01, 0, 0, 0.01, 0, 0)",
  }), false);
});

test("drops a parked hover-fill blob instead of cloning it as an absolute layer", () => {
  const { shouldPromoteFill, shouldDropPaintLayer } = load();
  const parked = {
    position: "absolute",
    opacity: "1",
    transform: "none",
    backgroundColor: "rgb(12, 21, 35)",
    backgroundImage: "none",
    hasText: false,
    hasMedia: false,
    coversParent: false,
  };
  assert.equal(shouldDropPaintLayer(parked), true);
  assert.equal(shouldPromoteFill(parked), false);
});

test("hugHeight omits used pixel height on text", () => {
  const { styleAttribute } = load();
  const css = styleAttribute(computed({
    height: "27.2px",
    "min-height": "27.2px",
    "max-height": "27.2px",
    "font-size": "16px",
    "line-height": "27.2px",
    color: "rgb(12, 30, 27)",
  }), { hugHeight: true });
  assert.doesNotMatch(css, /(?:^|;)height:/);
  assert.doesNotMatch(css, /min-height:/);
  assert.doesNotMatch(css, /max-height:/);
});

test("paint rest snapshot includes inset so fill blobs can settle", () => {
  const { paintSnapshot } = load();
  const snap = paintSnapshot(computed({
    transform: "none",
    opacity: "1",
    "background-color": "rgb(12, 21, 35)",
    "box-shadow": "none",
    width: "64px",
    height: "64px",
    top: "51px",
    left: "-64px",
    right: "170px",
    bottom: "-64px",
  }));
  assert.match(snap, /-64px/);
  assert.match(snap, /51px/);
});

test("styleAttribute uses the overlay fill when the button background is transparent", () => {
  const { styleAttribute } = load();
  const parent = computed({
    display: "flex",
    "background-color": "rgba(0, 0, 0, 0)",
    "box-shadow": "rgb(12, 21, 35) 0px 0px 0px 1px",
    color: "rgb(12, 21, 35)",
  });
  const fill = computed({
    "background-color": "rgb(12, 30, 27)",
  });
  const css = styleAttribute(parent, { fillComputed: fill });
  assert.match(css, /background-color:rgb\(12, 30, 27\)/);
  assert.match(css, /border:1px solid rgb\(12, 21, 35\)/);
  assert.doesNotMatch(css, /box-shadow:/);
});

function outlinedAfter(extra = {}) {
  return computed({
    content: '""',
    display: "block",
    position: "absolute",
    top: "0px",
    right: "0px",
    bottom: "0px",
    left: "0px",
    width: "170px",
    height: "51.2031px",
    "border-radius": "8px",
    "border-top-width": "1px",
    "border-right-width": "1px",
    "border-bottom-width": "1px",
    "border-left-width": "1px",
    "border-top-style": "solid",
    "border-right-style": "solid",
    "border-bottom-style": "solid",
    "border-left-style": "solid",
    "border-top-color": "rgb(12, 30, 27)",
    "border-right-color": "rgb(12, 30, 27)",
    "border-bottom-color": "rgb(12, 30, 27)",
    "border-left-color": "rgb(12, 30, 27)",
    opacity: "1",
    transform: "none",
    ...extra,
  });
}

test("materializes a Framer outlined-button ::after as a Paper border", () => {
  const { materializePseudo } = load();
  const next = materializePseudo(outlinedAfter());
  assert.ok(next);
  assert.equal(next.text, "");
  assert.match(next.style, /border:1px solid rgb\(12, 30, 27\)/);
  assert.match(next.style, /position:absolute/);
  assert.match(next.style, /inset:0px/);
});

test("skips pseudos that are not generated", () => {
  const { materializePseudo } = load();
  assert.equal(materializePseudo(computed({ content: "none" })), null);
  assert.equal(materializePseudo(computed({ content: "normal" })), null);
  assert.equal(materializePseudo(outlinedAfter({ content: '""' , "border-top-style": "none", "border-right-style": "none", "border-bottom-style": "none", "border-left-style": "none" })), null);
});

test("keeps a ::before that only has quoted content", () => {
  const { materializePseudo } = load();
  const next = materializePseudo(computed({
    content: '"Read more"',
    display: "block",
    opacity: "1",
  }));
  assert.equal(next.text, "Read more");
});

test("drops a scaled-away absolute pseudo", () => {
  const { shouldMaterializePseudo } = load();
  assert.equal(shouldMaterializePseudo(outlinedAfter({ transform: "scale(0)" })), false);
});

test("svgHrefId reads the fragment from a hash or page URL", () => {
  const { svgHrefId } = load();
  assert.equal(svgHrefId("#svg-1984002905_559"), "svg-1984002905_559");
  assert.equal(svgHrefId("https://kp-dover.framer.website/home-4?x=1#svg-1984002905_559"), "svg-1984002905_559");
  assert.equal(svgHrefId("/icons.svg#arrow"), "arrow");
  assert.equal(svgHrefId("https://example.com/icon.svg"), "");
  assert.equal(svgHrefId("url(#svg-98989652_1123)"), "svg-98989652_1123");
  assert.equal(svgHrefId("svg-98989652_1123"), "svg-98989652_1123");
});

test("svg styleAttribute copies fill and stroke", () => {
  const { styleAttribute } = load();
  const css = styleAttribute(computed({
    fill: "none",
    stroke: "rgb(1, 89, 65)",
    "stroke-width": "2px",
    "stroke-linecap": "round",
  }), { svg: true });
  assert.match(css, /fill:none/);
  assert.match(css, /stroke:rgb\(1, 89, 65\)/);
  assert.match(css, /stroke-width:2px/);
});

test("does not rewrite SVG or fragment hrefs into the live page URL", () => {
  const { shouldRewriteCapturedUrl } = load();
  assert.equal(shouldRewriteCapturedUrl("href", "#svg-1"), false);
  assert.equal(shouldRewriteCapturedUrl("href", "#svg-1", true), false);
  assert.equal(shouldRewriteCapturedUrl("href", "https://framerusercontent.com/icon.svg", true), false);
  assert.equal(shouldRewriteCapturedUrl("src", "https://cdn.example/a.png"), true);
  assert.equal(shouldRewriteCapturedUrl("href", "/about"), true);
});

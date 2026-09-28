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

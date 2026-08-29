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

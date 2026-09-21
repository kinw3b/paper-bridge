import test from "node:test";
import assert from "node:assert/strict";
import { mcpPayload, namedBoard, nodeId } from "./mcp-payload.mjs";

const fileStamp = {
  type: "text",
  text: JSON.stringify({
    file: { id: "file-1", name: "kp-loveline" },
    contentHash: { tokens: "0443b4ba" },
  }),
};

test("merges the file stamp with the artboard list", () => {
  const payload = mcpPayload({
    content: [
      fileStamp,
      {
        type: "text",
        text: JSON.stringify({
          artboards: [
            { id: "2RQ-0", name: "Navigation", childCount: 0 },
            { id: "1NB-0", name: "Navigation", childCount: 4 },
          ],
        }),
      },
    ],
  });
  assert.equal(payload.file.id, "file-1");
  assert.equal(nodeId(namedBoard(payload.artboards, "Navigation")), "1NB-0");
});

test("reads a create_artboard id from the second part", () => {
  const payload = mcpPayload({
    content: [
      fileStamp,
      { type: "text", text: JSON.stringify({ id: "2RU-0", name: "Navigation", width: 1400, height: null }) },
    ],
  });
  assert.equal(nodeId(payload), "2RU-0");
});

test("reads a write_html receipt from the second part", () => {
  const payload = mcpPayload({
    content: [
      fileStamp,
      { type: "text", text: JSON.stringify({ createdNodes: [{ id: "2RV-0", name: "Title" }] }) },
    ],
  });
  assert.equal(nodeId(payload), "2RV-0");
});

test("keeps a single-part result", () => {
  const payload = mcpPayload({
    content: [{ type: "text", text: JSON.stringify({ id: "only-1", artboards: [] }) }],
  });
  assert.equal(nodeId(payload), "only-1");
  assert.deepEqual(payload.artboards, []);
});

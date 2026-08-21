function payload(result) {
  for (const item of result?.content || []) {
    if (item.type !== "text") continue;
    try { return JSON.parse(item.text); } catch { return { text: item.text }; }
  }
  return result || {};
}

function childrenOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.children)) return raw.children;
  if (Array.isArray(raw?.nodes)) return raw.nodes;
  return [];
}

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function semanticName(node) {
  const tag = String(node.tag || "div").toLowerCase();
  const label = String(node.text || node.alt || tag).replace(/\s+/g, " ").trim().slice(0, 48) || tag;
  return `${tag} · ${label}`;
}

function isTextLayer(node) {
  return /text|richtext/i.test(node.component || "") || Boolean(node.textContent);
}

// Paper renders images as Rectangles with an image fill, so shape layers count too.
function isImageLayer(node) {
  return /image|img|svg|picture|rectangle/i.test(`${node.component || ""} ${node.name || ""}`);
}

function typeFits(node, tag) {
  if (tag === "img") return isImageLayer(node) && !isTextLayer(node);
  if (/^h[1-6]$/.test(tag) || ["p", "span", "li"].includes(tag)) return isTextLayer(node);
  return true;
}

function textScore(node, census) {
  const want = norm(census.text || census.alt);
  const text = norm(node.textContent);
  if (!want || !text) return 0;
  if (text === want) return 6;
  if (text.startsWith(want) || want.startsWith(text)) return 4;
  if (text.includes(want) || want.includes(text)) return 2;
  return 0;
}

// Paper mirrors the page layout, so page coordinates disambiguate what text cannot:
// duplicate copy (nav vs hero "Get Started Now") and images, which carry no text at all.
function geometryScore(node, census, scale) {
  if (!Number.isFinite(node.pageX) || !Number.isFinite(census.x)) return 0;
  const dx = Math.abs(node.pageX - census.x * scale);
  const dy = Math.abs(node.pageY - census.y * scale);
  const distance = dx + dy;
  if (distance > 120) return 0;
  if (distance <= 4) return 6;
  if (distance <= 16) return 4;
  if (distance <= 48) return 2;
  return 1;
}

function scorePaperNode(node, census, scale) {
  const tag = String(census.tag || "").toLowerCase();
  if (/^\d{2}\s*·/.test(node.name || "")) return 0;
  if (!typeFits(node, tag)) return 0;
  const byText = textScore(node, census);
  const byGeometry = geometryScore(node, census, scale);
  if (!byText && !byGeometry) return 0;
  // Either signal alone can carry a match; together they are decisive.
  return byText * 2 + byGeometry;
}

// Paper does not always report childCount, so recurse on every node and let an empty
// get_children end the branch; gating on childCount stopped the walk at depth 1.
async function walkPaperTree(call, rootId, depth = 0, budget = { left: 4000 }) {
  if (!rootId || depth > 16 || budget.left <= 0) return [];
  const list = childrenOf(payload(await call("get_children", { nodeId: rootId })));
  const out = [];
  for (const node of list) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    node.parentId = rootId;
    node.depth = depth;
    out.push(node);
    out.push(...await walkPaperTree(call, node.id, depth + 1, budget));
  }
  return out;
}

function interactiveContainer(hit, nodes, tag) {
  if (!hit || !["a", "button"].includes(tag)) return hit;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = hit;
  let component = hit;
  while (current?.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    const textLayer = /text|richtext/i.test(parent.component || "");
    if (!textLayer && Number(parent.childCount || parent.children?.length || 0) > 0) {
      component = parent;
      break;
    }
    current = parent;
  }
  current = component;
  while (current?.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || /^\d{2}\s*·/.test(parent.name || "")) break;
    if (Number(parent.childCount || parent.children?.length || 0) !== 1) break;
    current = parent;
  }
  return current;
}

async function hydratePaperTexts(call, nodes) {
  const leaves = nodes.filter((node) => !node.textContent
    && !/^\d{2}\s*·/.test(node.name || "")
    && (/text|image|img/i.test(node.component || "") || Number(node.childCount || 0) === 0));
  for (let index = 0; index < leaves.length; index += 8) {
    await Promise.all(leaves.slice(index, index + 8).map(async (node) => {
      try {
        const info = payload(await call("get_node_info", { nodeId: node.id }));
        node.textContent = info.textContent || node.textContent;
        node.component = info.component || node.component;
      } catch { /* Paper node changed during the scan */ }
    }));
  }
}

export async function applySemanticsToPaper({ call, doc, artboard = "home-desktop" } = {}) {
  const info = payload(await call("get_basic_info", {}));
  const board = (info.artboards || []).find((item) => item.name === artboard)
    || (info.artboards || []).find((item) => String(item.name || "").includes(artboard));
  if (!board?.id) throw new Error(`No ${artboard} artboard exists in Paper`);
  const boardX = Number(board.worldX || 0);
  const boardY = Number(board.worldY || 0);
  const scale = Number(board.width || 1600) / Number(doc.width || board.width || 1600);
  const children = childrenOf(payload(await call("get_children", { nodeId: board.id })));
  const sections = children.filter((node) => /^\d{2}\s*·/.test(node.name || ""));
  const scanned = (doc.sections || []).reduce((count, section) => count + (section.nodes || []).length, 0);

  // Live-DOM band numbers never line up with the pipeline's Paper sections, so search the
  // whole artboard by content instead of trusting the section id as an index.
  const tree = [];
  for (const frame of sections) {
    const nodes = await walkPaperTree(call, frame.id);
    for (const node of nodes) {
      node.sectionName = frame.name;
      node.pageX = Number(node.worldX) - boardX;
      node.pageY = Number(node.worldY) - boardY;
    }
    tree.push(...nodes);
  }
  await hydratePaperTexts(call, tree);

  const census = (doc.sections || []).flatMap((section) =>
    (section.nodes || []).map((node) => ({ ...node, sourceSection: section.id })));

  // Two passes so a loose partial match cannot consume a layer some exact match needs.
  const used = new Set();
  const updates = [];
  const unmatched = [];
  for (const floor of [14, 8, 3]) {
    for (const semantic of census) {
      if (semantic.claimed) continue;
      let best = null;
      let bestScore = 0;
      for (const node of tree) {
        if (used.has(node.id)) continue;
        const score = scorePaperNode(node, semantic, scale);
        if (score > bestScore) { bestScore = score; best = node; }
      }
      if (!best || bestScore < floor) continue;
      const hit = interactiveContainer(best, tree, String(semantic.tag || "").toLowerCase());
      if (used.has(hit.id)) continue;
      used.add(hit.id);
      semantic.claimed = true;
      const name = semantic.paperName || semanticName(semantic);
      if (hit.name !== name) updates.push({ nodeId: hit.id, name });
    }
  }
  for (const semantic of census) {
    if (!semantic.claimed) unmatched.push({ tag: semantic.tag, text: String(semantic.text || "").slice(0, 60) });
  }

  if (updates.length) {
    await call("rename_nodes", { updates });
    try { await call("finish_working_on_nodes", {}); } catch { /* optional Paper cleanup */ }
  }
  return {
    artboard,
    scanned,
    sourceSections: (doc.sections || []).length,
    missingSections: [],
    matched: used.size,
    renamed: updates.length,
    updates,
    debug: {
      artboard,
      paperSections: sections.map((node) => node.name),
      treeSize: tree.length,
      scale,
      unmatched: unmatched.slice(0, 80),
      paperNodes: tree.slice(0, 300).map((node) => ({
        name: node.name, component: node.component, section: node.sectionName,
        depth: node.depth, textContent: node.textContent, pageX: node.pageX, pageY: node.pageY,
      })),
    },
  };
}

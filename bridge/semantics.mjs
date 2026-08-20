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

function matchPaperNode(nodes, census) {
  const want = norm(census.text || census.alt);
  const tag = String(census.tag || "").toLowerCase();
  const scored = [];
  for (const node of nodes) {
    if (/^\d{2}\s*·/.test(node.name || "")) continue;
    if (new RegExp(`^${tag}\\s*·`, "i").test(node.name || "")
      && (!want || norm(node.name).includes(want.slice(0, 24)))) return node;
    const text = norm(node.textContent || node.name || "");
    const image = /image|img/i.test(node.component || "") || /image|img/i.test(node.name || "");
    if (tag === "img") {
      if (!image && !/photo|shot|media/i.test(node.name || "")) continue;
      if (!want) scored.push({ node, score: Number(node.childCount || 0) === 0 ? 2 : 1 });
      continue;
    }
    if (!text || !want) continue;
    if (text === want) scored.push({ node, score: Number(node.childCount || 0) === 0 ? 4 : 3 });
    else if (text.includes(want) || want.includes(text)) scored.push({ node, score: 1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 1 ? scored[0].node : null;
}

async function walkPaperTree(call, rootId, depth = 0) {
  if (!rootId || depth > 10) return [];
  const list = childrenOf(payload(await call("get_children", { nodeId: rootId })));
  const out = [];
  for (const node of list) {
    node.parentId = rootId;
    out.push(node);
    if (Number(node.childCount || node.children?.length || 0) > 0) {
      out.push(...await walkPaperTree(call, node.id, depth + 1));
    }
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
  const children = childrenOf(payload(await call("get_children", { nodeId: board.id })));
  const sections = children.filter((node) => /^\d{2}\s*·/.test(node.name || ""));
  const updates = [];
  const used = new Set();
  const scanned = (doc.sections || []).reduce((count, section) => count + (section.nodes || []).length, 0);
  const missingSections = [];
  for (const section of doc.sections || []) {
    const frame = sections.find((node) => String(node.name || "").startsWith(`${section.id} ·`));
    if (!frame) {
      missingSections.push(section.id);
      continue;
    }
    const tree = await walkPaperTree(call, frame.id);
    await hydratePaperTexts(call, tree);
    for (const semantic of section.nodes || []) {
      let hit = matchPaperNode(tree.filter((node) => !used.has(node.id)), semantic);
      if (!hit) continue;
      hit = interactiveContainer(hit, tree, String(semantic.tag || "").toLowerCase());
      if (used.has(hit.id)) continue;
      used.add(hit.id);
      const name = semantic.paperName || semanticName(semantic);
      if (hit.name !== name) updates.push({ nodeId: hit.id, name });
    }
  }
  if (updates.length) {
    await call("rename_nodes", { updates });
    try { await call("finish_working_on_nodes", {}); } catch { /* optional Paper cleanup */ }
  }
  return {
    artboard,
    scanned,
    sourceSections: (doc.sections || []).length,
    missingSections,
    matched: used.size,
    renamed: updates.length,
    updates,
  };
}

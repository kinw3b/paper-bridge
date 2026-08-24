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

function paperIdMap(paperLayerIds) {
  if (!paperLayerIds) return {};
  if (paperLayerIds.ids && typeof paperLayerIds.ids === "object") return paperLayerIds.ids;
  return paperLayerIds;
}

export function parsePcId(pcId) {
  const raw = String(pcId || "").trim();
  const prefixed = raw.match(/^pc-(\d{2})-(.+)$/);
  if (prefixed) return { sectionId: prefixed[1], path: `pc-${prefixed[2]}`, raw };
  if (raw.startsWith("pc-")) return { sectionId: "", path: raw, raw };
  return { sectionId: "", path: "", raw };
}

// Serializer child-index path (`0.2.1`). parsePcId.path is the Paper name (`pc-0.2.1`).
export function censusPath(pcId, fallback = "") {
  if (fallback) return String(fallback);
  const raw = String(pcId || "").trim();
  const prefixed = raw.match(/^pc-(\d{2})-(.+)$/);
  if (prefixed) return prefixed[2];
  if (raw.startsWith("pc-")) return raw.slice(3);
  return raw;
}

// Tags 2.2.a will actually retag. Landmarks only patch an existing sidecar row.
export const CONTENT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "img", "a", "button", "form", "label",
]);
export const LANDMARK_TAGS = new Set([
  "header", "nav", "main", "footer", "section", "article", "aside",
]);
export const GENERIC_TAGS = new Set(["div", "span", "i", "b", "strong", "em", "font", "u"]);

function cleanText(value, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function fillBlank(row, key, value) {
  const next = typeof value === "string" ? value.trim() : value;
  if (next === undefined || next === null || next === "") return false;
  const current = row[key];
  if (current !== undefined && current !== null && String(current).trim() !== "") return false;
  row[key] = typeof value === "string" ? cleanText(value, key === "text" ? 120 : 500) : value;
  return true;
}

function sectionLabelFor(payload, node) {
  const id = String(node.sectionId || parsePcId(node.pcId).sectionId || "").padStart(2, "0");
  const fromMeta = (payload.sections || []).find((section) => String(section.id || "") === id);
  if (fromMeta?.section) return fromMeta.section;
  const hit = Object.values(payload.ids || {}).find((row) => String(row.section || "").startsWith(`${id} ·`));
  if (hit?.section) return hit.section;
  const slug = node.sectionLabel || fromMeta?.slug || "section";
  return id ? `${id} · ${slug}` : String(slug);
}

function descendantRows(ids, parentPath) {
  if (!parentPath) return [];
  const prefix = `${parentPath}.`;
  return Object.entries(ids).filter(([, row]) => String(row.path || censusPath(row.pcId)).startsWith(prefix));
}

function closestDescendant(ids, parentPath) {
  const rows = descendantRows(ids, parentPath);
  rows.sort((a, b) => {
    const pathA = String(a[1].path || censusPath(a[1].pcId));
    const pathB = String(b[1].path || censusPath(b[1].pcId));
    const extraA = pathA.slice(parentPath.length + 1).split(".").length;
    const extraB = pathB.slice(parentPath.length + 1).split(".").length;
    if (extraA !== extraB) return extraA - extraB;
    const genericA = GENERIC_TAGS.has(String(a[1].tag || "").toLowerCase()) ? 0 : 1;
    const genericB = GENERIC_TAGS.has(String(b[1].tag || "").toLowerCase()) ? 0 : 1;
    return genericA - genericB;
  });
  return rows[0] || null;
}

function applyCensusFields(row, node) {
  const filled = [];
  if (fillBlank(row, "text", node.text || node.alt)) filled.push("text");
  if (fillBlank(row, "alt", node.alt)) filled.push("alt");
  if (fillBlank(row, "href", node.href)) filled.push("href");
  if (fillBlank(row, "src", node.src)) filled.push("src");
  if (fillBlank(row, "role", node.role)) filled.push("role");
  if (row.w == null && node.w != null) {
    row.w = Number(node.w);
    filled.push("w");
  }
  if (row.h == null && node.h != null) {
    row.h = Number(node.h);
    filled.push("h");
  }
  if (row.pageX == null && node.x != null) {
    row.pageX = Number(node.x);
    filled.push("pageX");
  }
  if (row.pageY == null && node.y != null) {
    row.pageY = Number(node.y);
    filled.push("pageY");
  }
  return filled;
}

function setLiveTag(row, tag) {
  const current = String(row.tag || "").toLowerCase();
  if (current === tag) return false;
  if (!row.sourceTag) row.sourceTag = row.tag ?? null;
  row.tag = tag;
  row.enrichedFrom = "paper-capture-extension";
  return true;
}

export function enrichLayerIds(payload, nodes = []) {
  if (!payload || typeof payload !== "object") {
    return { payload: payload || null, retagged: 0, filled: 0, added: 0, promoted: 0, validated: 0 };
  }
  const ids = payload.ids && typeof payload.ids === "object" ? { ...payload.ids } : {};
  const used = new Set();
  let retagged = 0;
  let filled = 0;
  let added = 0;
  let promoted = 0;
  let validated = 0;

  for (const node of nodes) {
    const pcId = String(node?.pcId || "").trim();
    const tag = String(node?.tag || "").toLowerCase();
    if (!pcId || (!CONTENT_TAGS.has(tag) && !LANDMARK_TAGS.has(tag))) continue;
    const path = censusPath(pcId, node.path);
    const exact = ids[pcId];

    if (exact) {
      const before = String(exact.tag || "").toLowerCase();
      if (before !== tag && (GENERIC_TAGS.has(before) || CONTENT_TAGS.has(tag) || LANDMARK_TAGS.has(tag))) {
        if (setLiveTag(exact, tag)) retagged += 1;
      } else {
        validated += 1;
      }
      if (applyCensusFields(exact, node).length) filled += 1;
      used.add(pcId);
      continue;
    }

    if (LANDMARK_TAGS.has(tag) && !CONTENT_TAGS.has(tag)) continue;

    const descendant = closestDescendant(ids, path);
    if (descendant && !used.has(descendant[0])) {
      const [childId, child] = descendant;
      const childTag = String(child.tag || "").toLowerCase();
      const locked = CONTENT_TAGS.has(childTag) && !GENERIC_TAGS.has(childTag) && childTag !== tag
        && !["p", "span", "div"].includes(childTag);
      if (!locked && (GENERIC_TAGS.has(childTag) || childTag === "p" || childTag === tag)) {
        if (setLiveTag(child, tag)) {
          promoted += 1;
          retagged += 1;
        }
        if (applyCensusFields(child, node).length) filled += 1;
        used.add(childId);
        continue;
      }
    }

    ids[pcId] = {
      pcId,
      path,
      tag,
      class: "",
      classes: [],
      role: node.role || "",
      "data-framer-name": "",
      text: cleanText(node.text || node.alt),
      alt: node.alt || "",
      href: node.href || "",
      src: node.src || "",
      pageX: node.x != null ? Number(node.x) : undefined,
      pageY: node.y != null ? Number(node.y) : undefined,
      w: node.w != null ? Number(node.w) : undefined,
      h: node.h != null ? Number(node.h) : undefined,
      section: sectionLabelFor({ ...payload, ids }, node),
      enrichedFrom: "paper-capture-extension",
    };
    added += 1;
    used.add(pcId);
  }

  const counts = new Map();
  for (const row of Object.values(ids)) {
    const label = String(row.section || "");
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const sections = (payload.sections || []).map((section) => ({
    ...section,
    ids: counts.get(section.section) ?? counts.get(`${section.id} · ${section.slug}`) ?? section.ids,
  }));

  return {
    payload: {
      ...payload,
      generatedFrom: payload.generatedFrom || "url-to-paper/serializer",
      enrichedFrom: "paper-capture-extension",
      enrichedAt: new Date().toISOString(),
      total: Object.keys(ids).length,
      sections,
      ids,
    },
    retagged,
    filled,
    added,
    promoted,
    validated,
  };
}

export function sectionMeta(name) {
  const raw = String(name || "").trim();
  const numbered = raw.match(/^(\d{2})\s*·\s*(.+)$/);
  if (numbered) return { id: numbered[1], slug: numbered[2].trim().toLowerCase(), name: raw };
  return { id: "", slug: raw.toLowerCase(), name: raw };
}

function isSemanticName(name) {
  return /^[a-z][a-z0-9]*\s*·/i.test(String(name || "").trim());
}

function findBoard(artboards, name) {
  return (artboards || []).find((item) => item.name === name)
    || (artboards || []).find((item) => String(item.name || "").includes(name));
}

function findSectionFrame(sections, section) {
  const id = String(section.id || "").padStart(2, "0");
  const slug = String(section.slug || section.sectionLabel || "").trim().toLowerCase();
  return (sections || []).find((node) => String(node.name || "").startsWith(`${id} ·`))
    || (sections || []).find((node) => sectionMeta(node.name).slug === slug)
    || (sections || []).find((node) => {
      const other = sectionMeta(node.name).slug;
      return slug && other && (other.includes(slug) || slug.includes(other));
    });
}

function mappedId(paperByPc, pcId) {
  const mapped = paperByPc[pcId];
  return typeof mapped === "string" ? mapped : mapped?.id || "";
}

export function matchPaperNode(nodes, census) {
  const pcId = String(census.pcId || "").trim();
  if (pcId) {
    const path = parsePcId(pcId).path;
    const exact = (nodes || []).find((node) => node.name === pcId || node.pcId === pcId
      || (path && node.name === path));
    if (exact) return exact;
  }
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

async function listChildren(call, nodeId) {
  return childrenOf(payload(await call("get_children", { nodeId })));
}

async function mapChunk(items, size, fn) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(...await Promise.all(items.slice(index, index + size).map(fn)));
  }
  return out;
}

async function walkPaperTree(call, rootId) {
  if (!rootId) return [];
  const out = [];
  let level = (await listChildren(call, rootId)).map((node, index) => {
    node.parentId = rootId;
    node.treePath = String(index);
    return node;
  });
  let depth = 0;
  while (level.length && depth <= 24) {
    out.push(...level);
    const parents = level.filter((node) => Number(node.childCount || node.children?.length || 0) > 0);
    const groups = await mapChunk(parents, 10, async (parent) => {
      const list = await listChildren(call, parent.id);
      return list.map((node, index) => {
        node.parentId = parent.id;
        node.treePath = `${parent.treePath}.${index}`;
        return node;
      });
    });
    level = groups.flat();
    depth += 1;
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

export async function applySemanticsToPaper({ call, doc, artboard = "home-desktop", paperLayerIds } = {}) {
  const info = payload(await call("get_basic_info", {}));
  const board = findBoard(info.artboards, artboard);
  if (!board?.id) throw new Error(`No ${artboard} artboard exists in Paper`);
  const sections = childrenOf(payload(await call("get_children", { nodeId: board.id })));
  const updates = [];
  const propagate = [];
  const used = new Set();
  const scanned = (doc.sections || []).reduce((count, section) => count + (section.nodes || []).length, 0);
  const missingSections = [];
  const paperByPc = paperIdMap(paperLayerIds);
  let matchedByLayerId = 0;
  const queueRename = (nodeId, semantic, extra = {}) => {
    if (!nodeId || used.has(nodeId)) return false;
    const name = semantic.paperName || semanticName(semantic);
    used.add(nodeId);
    updates.push({ nodeId, name });
    const from = extra.from || parsePcId(semantic.pcId).path;
    if (from && from !== name) {
      propagate.push({
        sectionId: extra.sectionId || semantic.sectionId || "",
        slug: String(extra.slug || semantic.sectionLabel || "").toLowerCase(),
        from,
        to: name,
        treePath: extra.treePath || "",
      });
    }
    return true;
  };
  const framed = [];
  for (const section of doc.sections || []) {
    const frame = findSectionFrame(sections, section);
    if (!frame) {
      missingSections.push(section.id);
      continue;
    }
    framed.push({ section, frame });
  }
  const walked = await mapChunk(framed, 3, async ({ section, frame }) => ({
    section,
    frame,
    tree: await walkPaperTree(call, frame.id),
  }));
  const sectionTrees = {};
  for (const { section, frame, tree } of walked) {
    const meta = sectionMeta(frame.name);
    const slug = meta.slug || String(section.slug || "").toLowerCase();
    if (slug) sectionTrees[slug] = { id: frame.id, name: frame.name, nodes: tree };
    const sectionIds = new Set(tree.map((node) => node.id));
    const byName = new Map();
    for (const node of tree) {
      const name = String(node.name || "").trim();
      if (name.startsWith("pc-") && !byName.has(name)) byName.set(name, node);
    }
    const leftovers = [];
    for (const semantic of section.nodes || []) {
      const parsed = parsePcId(semantic.pcId);
      const named = byName.get(parsed.path) || byName.get(parsed.raw);
      const mapped = [semantic.pcId, parsed.path, parsed.raw]
        .filter(Boolean)
        .map((key) => mappedId(paperByPc, key))
        .find((id) => id && sectionIds.has(id));
      const nodeId = (mapped && sectionIds.has(mapped) ? mapped : "") || named?.id || "";
      if (nodeId && queueRename(nodeId, semantic, {
        from: named?.name || parsed.path,
        treePath: named?.treePath || "",
        sectionId: section.id,
        slug: section.slug,
      })) {
        matchedByLayerId += 1;
        continue;
      }
      leftovers.push(semantic);
    }
    if (!leftovers.length) continue;
    await hydratePaperTexts(call, tree);
    for (const semantic of leftovers) {
      let hit = matchPaperNode(tree.filter((node) => !used.has(node.id)), semantic);
      if (!hit) continue;
      const parsed = parsePcId(semantic.pcId);
      if (semantic.pcId && (hit.name === semantic.pcId || hit.name === parsed.path)) matchedByLayerId += 1;
      else hit = interactiveContainer(hit, tree, String(semantic.tag || "").toLowerCase());
      if (used.has(hit.id)) continue;
      queueRename(hit.id, semantic, {
        from: String(hit.name || "").startsWith("pc-") ? hit.name : parsed.path,
        treePath: hit.treePath || "",
        sectionId: section.id,
        slug: section.slug,
      });
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
    matchedByLayerId,
    renamed: updates.length,
    updates,
    propagate,
    sectionTrees,
  };
}

export function pcIdNames(doc) {
  const names = new Map();
  for (const section of doc.sections || []) {
    const slug = String(section.slug || "").trim().toLowerCase();
    for (const node of section.nodes || []) {
      const parsed = parsePcId(node.pcId);
      if (!parsed.path) continue;
      const name = node.paperName || semanticName(node);
      names.set(node.pcId, name);
      names.set(parsed.path, name);
      if (section.id) names.set(`${section.id}::${parsed.path}`, name);
      if (slug) names.set(`${slug}::${parsed.path}`, name);
    }
  }
  return names;
}

export function siblingHomeArtboards(artboards, primary = "home-desktop") {
  return (artboards || [])
    .map((item) => item.name)
    .filter((name) => name && name !== primary && /^home-/.test(String(name)));
}

function sourceTreeFor(sourceTrees, meta) {
  if (!sourceTrees || !meta) return null;
  return sourceTrees[meta.slug]
    || Object.values(sourceTrees).find((row) => sectionMeta(row.name).id && sectionMeta(row.name).id === meta.id)
    || null;
}

export async function applyPcIdNamesToArtboard({
  call, artboard, names, propagate = [], sourceArtboard = "home-desktop",
  sourceTrees, artboards,
} = {}) {
  if (!artboard) return { artboard, renamed: 0, matched: 0 };
  const boards = artboards || payload(await call("get_basic_info", {})).artboards;
  const source = findBoard(boards, sourceArtboard);
  const board = findBoard(boards, artboard);
  if (!board?.id) throw new Error(`No ${artboard} artboard exists in Paper`);
  let trees = sourceTrees;
  if (!trees && source?.id) {
    const sourceSections = childrenOf(payload(await call("get_children", { nodeId: source.id })));
    trees = {};
    const walked = await mapChunk(sourceSections, 3, async (frame) => ({
      frame,
      tree: await walkPaperTree(call, frame.id),
    }));
    for (const { frame, tree } of walked) {
      const meta = sectionMeta(frame.name);
      if (meta.slug) trees[meta.slug] = { id: frame.id, name: frame.name, nodes: tree };
    }
  }
  const targetSections = childrenOf(payload(await call("get_children", { nodeId: board.id })));
  const walkedTargets = await mapChunk(targetSections, 3, async (targetSection) => ({
    targetSection,
    meta: sectionMeta(targetSection.name),
    targetTree: await walkPaperTree(call, targetSection.id),
  }));
  const updates = [];
  const seen = new Set();
  const queue = (nodeId, name) => {
    if (!nodeId || !name || seen.has(nodeId)) return;
    seen.add(nodeId);
    updates.push({ nodeId, name });
  };
  for (const { meta, targetTree } of walkedTargets) {
    const byPath = new Map(targetTree.map((node) => [node.treePath, node]));
    const byName = new Map();
    for (const node of targetTree) {
      const current = String(node.name || "").trim();
      if (current.startsWith("pc-") && !byName.has(current)) byName.set(current, node);
    }
    const sourceTree = sourceTreeFor(trees, meta)?.nodes || [];
    for (const node of sourceTree) {
      const name = String(node.name || "").trim();
      if (!isSemanticName(name)) continue;
      const hit = byPath.get(node.treePath);
      if (!hit || hit.name === name) continue;
      const current = String(hit.name || "").trim();
      if (current.startsWith("pc-") || !isSemanticName(current)) queue(hit.id, name);
    }
    for (const row of propagate) {
      if (row.slug && meta.slug && row.slug !== meta.slug) continue;
      if (row.sectionId && meta.id && row.sectionId !== meta.id) continue;
      const hit = (row.from && byName.get(row.from))
        || (row.treePath && byPath.get(row.treePath));
      if (hit) queue(hit.id, row.to);
    }
    if (names?.get) {
      for (const node of targetTree) {
        const current = String(node.name || "").trim();
        if (!current.startsWith("pc-")) continue;
        const next = names.get(`${meta.id}::${current}`)
          || names.get(`${meta.slug}::${current}`);
        if (next && next !== current) queue(node.id, next);
      }
    }
  }
  if (updates.length) {
    await call("rename_nodes", { updates });
    try { await call("finish_working_on_nodes", {}); } catch { /* optional Paper cleanup */ }
  }
  return { artboard, renamed: updates.length, matched: updates.length };
}

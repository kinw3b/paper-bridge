// Paper Desktop prepends a { file, contentHash } text part on every tool result.
// The artboard list and node ids live in a later part. Merge all of them.

export function mcpPayload(result) {
  const merged = {};
  let saw = false;
  for (const item of result?.content || []) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    let parsed;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      if (!saw) merged.text = item.text;
      saw = true;
      continue;
    }
    saw = true;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.assign(merged, parsed);
    } else if (!Object.hasOwn(merged, "value")) {
      merged.value = parsed;
    }
  }
  return saw ? merged : {};
}

export function nodeId(payload) {
  return payload?.createdNodes?.[0]?.id || payload?.ids?.[0] || payload?.nodeId || payload?.id || null;
}

export function namedBoard(artboards, name) {
  const matches = (artboards || []).filter((item) => item?.name === name && item?.id);
  return matches.find((item) => Number(item.childCount) > 0) || matches[0] || null;
}

(() => {
  // Paper Snapshot 0.3.8 serializer (lidfahaahiogmnlccifabccgplofocck).
  // The official picker never selects SVGElement — only an HTML host — then this
  // walk inlines <use>, copies SVG geometry attrs, and diffs computed CSS.
  const VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
  ]);
  const ALWAYS_STYLE = ["display", "appearance", "box-sizing"];
  const TABLE_TAGS = new Set([
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  ]);
  const SKIP_TAGS = new Set(["script", "style", "meta", "link", "noscript"]);
  const COLLAPSED_TRANSFORMS = new Set([
    "matrix(0, 0, 0, 1, 0, 0)",
    "matrix(0, 0, 0, 0, 0, 0)",
    "scaleX(0)",
    "scale(0)",
    "scaleY(0)",
  ]);

  function svgHrefId(href) {
    const raw = String(href || "").trim();
    if (!raw) return "";
    const urlFn = raw.match(/url\(\s*['"]?#([^)'"]+)/i);
    if (urlFn) {
      try { return decodeURIComponent(urlFn[1]); } catch { return urlFn[1]; }
    }
    if (raw.includes("#")) {
      const hash = raw.slice(raw.lastIndexOf("#") + 1);
      if (!hash) return "";
      try { return decodeURIComponent(hash); } catch { return hash; }
    }
    if (/^[A-Za-z_][\w.-]*$/.test(raw)) return raw;
    return "";
  }

  function elementId(element) {
    if (typeof element.id === "string") return element.id;
    return element.getAttribute?.("id") || "";
  }

  function isPaperChrome(element) {
    const tag = element.tagName?.toLowerCase?.() || "";
    const id = elementId(element);
    return tag.startsWith("x-paper-")
      || id.startsWith("x-paper-")
      || element.hasAttribute?.("data-paper-tool");
  }

  function isSvgDescendant(element) {
    let node = element.parentElement;
    while (node) {
      if (node instanceof SVGElement) return true;
      node = node.parentElement;
    }
    return false;
  }

  function cssText(styles) {
    return Object.entries(styles).map(([name, value]) => `${name}: ${value};`).join(" ");
  }

  function escapeText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  }

  function pseudoContentText(styles) {
    const raw = styles.content;
    if (!raw) return "";
    const primary = String(raw).split(" / ")[0];
    let text = "";
    for (const match of primary.matchAll(/(['"])(.*?)\1/g)) text += match[2];
    return text;
  }

  function collapsedAbsolute(styles) {
    return COLLAPSED_TRANSFORMS.has(styles.transform || "")
      && ["absolute", "fixed"].includes(styles.position || "");
  }

  function nearestBackground(element) {
    if (!element) return "";
    let node = element.parentElement;
    if (!node && element.parentNode instanceof ShadowRoot && element.parentNode.host instanceof Element) {
      node = element.parentNode.host;
    }
    if (!node) return "";
    const color = window.getComputedStyle(node).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
    return nearestBackground(node);
  }

  function readStyleMap(element, pseudo) {
    const names = stylePropertyNames();
    const map = new Map();
    if (pseudo) {
      const computed = window.getComputedStyle(element, pseudo);
      for (const name of names) map.set(name, computed.getPropertyValue(name));
      return map;
    }
    const typed = element.computedStyleMap?.();
    const computed = window.getComputedStyle(element);
    for (const name of names) {
      const typedValue = typed?.get(name);
      if (typedValue) map.set(name, typedValue.toString());
      else {
        const value = computed.getPropertyValue(name);
        if (value) map.set(name, value);
      }
    }
    return map;
  }

  let cachedStyleNames = null;
  function stylePropertyNames() {
    if (cachedStyleNames) return cachedStyleNames;
    const names = Array.from(window.getComputedStyle(document.body || document.documentElement));
    names.push(
      "aspect-ratio",
      "paint-order",
      "text-underline-offset",
      "text-decoration-thickness",
      "transform-box",
      "-webkit-text-stroke-color",
      "-webkit-text-stroke-width",
    );
    cachedStyleNames = names;
    return names;
  }

  function attachProbe(element, probe) {
    try {
      if (element.parentElement?.lastElementChild === element) element.insertAdjacentElement("afterend", probe);
      else element.insertAdjacentElement("beforebegin", probe);
      return true;
    } catch {
      try {
        document.documentElement.append(probe);
        return true;
      } catch {
        return false;
      }
    }
  }

  function computedStyles(element, { isRoot = false, pseudo } = {}) {
    const next = {};
    const target = readStyleMap(element, pseudo);
    const probe = document.createElement("link");
    probe.textContent = element.textContent;
    probe.style.setProperty("background-color", "transparent", "important");
    probe.style.setProperty("border-color", "hotpink", "important");
    probe.style.setProperty("border-radius", "0", "important");
    probe.style.setProperty("border-width", "0px", "important");
    probe.style.setProperty("border-style", "none", "important");
    probe.style.setProperty("box-shadow", "none", "important");
    probe.style.setProperty("fill", "black", "important");
    probe.style.setProperty("font-size", "1px", "important");
    probe.style.setProperty("font-weight", "400", "important");
    probe.style.setProperty("height", "auto", "important");
    probe.style.setProperty("margin", "0", "important");
    probe.style.setProperty("overflow", "visible", "important");
    probe.style.setProperty("padding", "0", "important");
    probe.style.setProperty("text-align", "initial", "important");
    probe.style.setProperty("width", "auto", "important");
    probe.style.setProperty("z-index", "auto", "important");
    if (isRoot) {
      probe.style.color = "hotpink";
      probe.style.lineHeight = "0.1234";
      probe.style.fontFamily = '"Papyrus"';
      probe.style.listStyleType = "initial";
    }
    if (!attachProbe(element, probe)) return {};
    const baseline = readStyleMap(probe, pseudo);
    probe.remove();
    for (const name of stylePropertyNames()) {
      const value = target.get(name);
      const prior = baseline.get(name);
      if (value && !value.startsWith("--") && (value !== prior || ALWAYS_STYLE.includes(name))) {
        next[name] = value.replaceAll('"', "'");
      }
    }
    if (isRoot) {
      const box = element.getBoundingClientRect();
      const width = `${Math.ceil(box.width)}px`;
      const height = `${Math.ceil(box.height)}px`;
      if (box.width > 200 || box.height > 200 || next.width?.includes("%") || next.height?.includes("%")) {
        next.width = width;
        next.height = height;
      }
    }
    if (isRoot && element instanceof Element) {
      const background = target.get("background-color");
      if (!background || background === "rgba(0, 0, 0, 0)") next["background-color"] = nearestBackground(element);
    }
    if (next["scrollbar-gutter"]?.includes("stable") && element instanceof HTMLElement) {
      const borderLeft = parseFloat(target.get("border-left-width") || "0");
      const borderRight = parseFloat(target.get("border-right-width") || "0");
      const gutter = element.offsetWidth - element.clientWidth - borderLeft - borderRight;
      if (gutter > 0) {
        const both = next["scrollbar-gutter"].includes("both");
        const rtl = (target.get("direction") || "ltr") === "rtl";
        const padRight = parseFloat(next["padding-right"] || "0");
        const padLeft = parseFloat(next["padding-left"] || "0");
        if (rtl) {
          next["padding-left"] = `${padLeft + gutter}px`;
          if (both) next["padding-right"] = `${padRight + gutter}px`;
        } else {
          next["padding-right"] = `${padRight + gutter}px`;
          if (both) next["padding-left"] = `${padLeft + gutter}px`;
        }
      }
    }
    if ((pseudo === "::after" || pseudo === "::before") && !next.content) return {};
    return Object.keys(next).length ? next : {};
  }

  function visibleText(node) {
    const value = node.textContent;
    if (!value) return "";
    if (node.parentElement) {
      const whiteSpace = window.getComputedStyle(node.parentElement).whiteSpace;
      if (whiteSpace === "pre" || whiteSpace === "pre-wrap") return value;
      if (whiteSpace === "pre-line") return value.replace(/[\t\f\r ]+/g, " ");
    }
    const collapsed = value.replace(/[\t\n\r\f ]+/g, " ").replace(/^ | $/g, "");
    if (collapsed) {
      const lead = /^[\t\n\r\f ]*/.exec(value)[0].length;
      const trail = /[\t\n\r\f ]*$/.exec(value)[0].length;
      let keepLead = false;
      let keepTrail = false;
      if (lead > 0) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, lead);
        keepLead = range.getBoundingClientRect().width > 0;
      }
      if (trail > 0) {
        const range = document.createRange();
        range.setStart(node, value.length - trail);
        range.setEnd(node, value.length);
        keepTrail = range.getBoundingClientRect().width > 0;
      }
      return `${keepLead ? " " : ""}${collapsed}${keepTrail ? " " : ""}`;
    }
    const range = document.createRange();
    range.selectNode(node);
    return range.getBoundingClientRect().width === 0 ? "" : " ";
  }

  function useHref(element) {
    try {
      const animated = element.href && typeof element.href === "object"
        ? (element.href.baseVal || element.href.animVal)
        : "";
      return animated
        || element.getAttribute("href")
        || element.getAttributeNS?.("http://www.w3.org/1999/xlink", "href")
        || element.getAttribute("xlink:href")
        || "";
    } catch {
      return element.getAttribute?.("href") || "";
    }
  }

  function findById(id, source) {
    if (!id) return null;
    const usable = (node) => Boolean(node) && node !== source && !node.contains?.(source);
    const root = source.getRootNode?.() || source.ownerDocument;
    try {
      if (root instanceof Document || root instanceof ShadowRoot) {
        const hit = root.getElementById(id);
        if (usable(hit)) return hit;
      }
    } catch { /* closed tree */ }
    try {
      const hit = source.ownerDocument.getElementById(id);
      if (usable(hit)) return hit;
    } catch { /* no document */ }
    const queue = [source.ownerDocument];
    const seen = new Set();
    let selector = "";
    try { selector = `[id="${CSS.escape(id)}"]`; } catch { selector = ""; }
    while (queue.length) {
      const tree = queue.shift();
      if (!tree || seen.has(tree)) continue;
      seen.add(tree);
      try {
        if (typeof tree.getElementById === "function") {
          const hit = tree.getElementById(id);
          if (usable(hit)) return hit;
        }
        const match = selector ? tree.querySelector?.(selector) : null;
        if (usable(match)) return match;
        for (const node of tree.querySelectorAll?.("*") || []) {
          if (node.shadowRoot) queue.push(node.shadowRoot);
        }
      } catch { /* skip */ }
    }
    return null;
  }

  function expandUse(useEl, parentAttrs) {
    const referenced = findById(svgHrefId(useHref(useEl)), useEl);
    if (!referenced) return [];
    const tag = referenced.tagName.toLowerCase();
    if (tag === "symbol" || tag === "svg") {
      const hoist = new Set(["viewBox", "preserveAspectRatio"]);
      for (const name of referenced.getAttributeNames()) {
        if (["id", "class", "style"].includes(name)) continue;
        const value = referenced.getAttribute(name);
        if (hoist.has(name)) {
          const index = parentAttrs.findIndex(([key]) => key === name);
          if (index >= 0) parentAttrs.splice(index, 1);
          parentAttrs.push([name, value]);
        } else if (!parentAttrs.some(([key]) => key === name)) {
          parentAttrs.push([name, value]);
        }
      }
      return [...referenced.childNodes];
    }
    return [referenced];
  }

  function serializeNode(node, { isRoot = false, flattenMotion = false, layerName = "" } = {}) {
    if (!(node instanceof Element || node instanceof SVGElement)) {
      if (node instanceof Text) return escapeText(visibleText(node));
      return "";
    }
    const tag = node.tagName.toLowerCase();
    const computed = window.getComputedStyle(node);
    const positioned = ["absolute", "fixed"].includes(computed.position);
    const parentBlock = Boolean(node.parentElement)
      && ["block", "inline-block"].includes(window.getComputedStyle(node.parentElement).display);
    const zero = parseFloat(computed.height) === 0 || parseFloat(computed.width) === 0;
    const padded = parseFloat(computed.paddingTop) > 0
      || parseFloat(computed.paddingRight) > 0
      || parseFloat(computed.paddingBottom) > 0
      || parseFloat(computed.paddingLeft) > 0;
    const clipped = computed.overflowX !== "visible" && computed.overflowY !== "visible";
    const clippedZero = zero && (positioned || parentBlock) && !padded && clipped;
    const displayNone = computed.display === "none";
    const parent = node.parentElement ?? (node.parentNode instanceof ShadowRoot ? node.parentNode : null);
    const hiddenOpacity = computed.opacity === "0" && (positioned || parent?.childElementCount === 1);
    const skipTag = SKIP_TAGS.has(tag) || isPaperChrome(node);
    const invisible = computed.display !== "contents"
      && !isSvgDescendant(node)
      && typeof node.checkVisibility === "function"
      && !node.checkVisibility();
    if (clippedZero || displayNone || hiddenOpacity || skipTag || invisible) return "";

    const kids = [];
    let styles = {};
    const canStyle = !(node instanceof SVGElement) || node instanceof SVGGraphicsElement;
    if (canStyle) {
      const before = computedStyles(node, { pseudo: "::before" });
      if (Object.keys(before).length && !collapsedAbsolute(before)) {
        const text = pseudoContentText(before);
        delete before.content;
        kids.push(`<div style="${cssText(before)}">${escapeText(text)}</div>`);
      }
      styles = computedStyles(node, { isRoot });
    }

    const sourceAttrs = node.getAttributeNames().map((name) => [name, node.getAttribute(name) || ""]);
    const childNodes = node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes];
    for (const child of childNodes) {
      let expanded = [];
      if (child instanceof HTMLSlotElement) expanded = [...child.assignedNodes({ flatten: true })];
      else if (child instanceof SVGElement && child.tagName.toLowerCase() === "use") expanded = expandUse(child, sourceAttrs);
      else if (node instanceof HTMLSelectElement) {
        const option = node.options[node.selectedIndex];
        if (option) kids.push(`<option selected>${escapeText(option.textContent || "")}</option>`);
        continue;
      } else if (child) expanded = [child];
      for (const next of expanded) kids.push(serializeNode(next, { isRoot: false }));
    }

    const after = computedStyles(node, { pseudo: "::after" });
    if (Object.keys(after).length && !collapsedAbsolute(after)) {
      const text = pseudoContentText(after);
      delete after.content;
      kids.push(`<div style="${cssText(after)}">${escapeText(text)}</div>`);
    }

    const attrs = [];
    if (node instanceof HTMLImageElement) {
      attrs.push(["src", node.src]);
      if (!styles.width && !styles.height) {
        const image = window.getComputedStyle(node);
        styles.width = image.width;
        styles.height = image.height;
      }
    }
    if (node instanceof HTMLInputElement) {
      if (node.value) attrs.push(["value", node.value]);
      if (node.type) attrs.push(["type", node.type]);
      if (node.checked || node.defaultChecked) attrs.push(["checked", "true"]);
      if (node.placeholder) {
        const placeholder = computedStyles(node, { pseudo: "::placeholder" });
        attrs.push(["placeholder", node.placeholder]);
        attrs.push(["data-paper-placeholder-styles", cssText(placeholder)]);
      }
    } else if (node instanceof HTMLTextAreaElement) {
      if (node.value) kids.unshift(escapeText(node.value));
      if (node.placeholder) {
        const placeholder = computedStyles(node, { pseudo: "::placeholder" });
        attrs.push(["placeholder", node.placeholder]);
        attrs.push(["data-paper-placeholder-styles", cssText(placeholder)]);
      }
    }

    const outTag = TABLE_TAGS.has(tag) || tag === "body" ? "div" : tag;
    if (outTag !== tag) attrs.push(["paper-snapshot-original-tag", node.tagName]);
    if (node instanceof SVGElement) {
      const svgStyle = window.getComputedStyle(node);
      if (styles.width === undefined || styles.width === "auto") styles.width = svgStyle.width;
      if (styles.height === undefined || styles.height === "auto") styles.height = svgStyle.height;
      for (let [name, value] of sourceAttrs) {
        if (["class", "style", "display", "overflow"].includes(name) || !value) continue;
        if (["fill", "stroke", "color"].includes(name)) {
          let painted = styles[name];
          if (painted === undefined && value.toLowerCase() === "currentcolor") painted = styles.color;
          if (painted) value = painted;
        }
        attrs.push([name, value]);
        if (name !== "width" && name !== "height") delete styles[name];
      }
    }
    if (isRoot && flattenMotion) {
      styles.position = "relative";
      styles.transform = "none";
      styles.left = "auto";
      styles.top = "auto";
      styles.margin = styles.margin || "0";
    }
    if (isRoot && layerName) attrs.unshift(["layer-name", layerName]);
    if (Object.keys(styles).length) {
      if (styles.width || styles.height) {
        styles.width ??= "auto";
        styles.height ??= "auto";
      }
      attrs.push(["style", cssText(styles)]);
    }
    const keep = isSvgDescendant(node)
      || (typeof node.checkVisibility === "function" && node.checkVisibility() && styles.display !== "contents")
      || isRoot;
    if (!keep) return kids.join("");
    const open = `<${outTag}${attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join("")}>`;
    const close = VOID_TAGS.has(outTag) ? "" : `</${outTag}>`;
    return `${open}${kids.join("")}${close}`;
  }

  function serialize(element, { layerName = "", flattenMotion = false } = {}) {
    if (!(element instanceof Element)) return "";
    return serializeNode(element, { isRoot: true, flattenMotion, layerName });
  }

  globalThis.PaperCaptureSnapshot = {
    serialize,
    svgHrefId,
    expandUse,
    findById,
  };
})();

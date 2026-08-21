(() => {
  if (window.__PAPER_CAPTURE_EXTENSION__) return;
  window.__PAPER_CAPTURE_EXTENSION__ = true;

  const state = {
    recording: false,
    mode: "nav",
    captureKind: "navbar",
    hovered: null,
    hoverSource: null,
    parentDepth: 0,
    selected: new Map(),
    sequence: 0,
    semanticOverlays: new Map(),
    sectionRoots: null,
    sectionRootsAt: 0,
  };

  const root = document.createElement("x-paper-capture-root");
  root.setAttribute("data-paper-tool", "capture-extension");
  const box = document.createElement("x-paper-capture-box");
  const chip = document.createElement("x-paper-capture-chip");
  const status = document.createElement("x-paper-capture-status");
  const lamp = document.createElement("x-paper-capture-lamp");
  const statusText = document.createElement("span");
  box.append(chip);
  status.append(lamp, statusText);
  root.append(box, status);
  document.documentElement.append(root);

  const STYLE_PROPS = [
    "display", "position", "box-sizing", "width", "height", "min-width", "min-height",
    "max-width", "max-height", "flex", "flex-direction", "flex-wrap", "flex-grow",
    "flex-shrink", "align-items", "align-self", "justify-content", "gap", "row-gap",
    "column-gap", "grid-template-columns", "grid-template-rows", "grid-auto-flow",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top",
    "margin-right", "margin-bottom", "margin-left", "overflow", "opacity", "visibility",
    "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "border-top-width", "border-right-width", "border-bottom-width",
    "border-left-width", "border-top-style", "border-right-style", "border-bottom-style",
    "border-left-style", "border-top-color", "border-right-color", "border-bottom-color",
    "border-left-color", "border-radius", "outline-width", "outline-style", "outline-color",
    "outline-offset", "box-shadow", "color", "font-family", "font-size",
    "font-style", "font-weight", "letter-spacing", "line-height", "text-align",
    "text-decoration", "text-transform", "white-space", "object-fit", "object-position",
    "transform", "transform-origin", "filter", "clip-path"
  ];

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const KEEP_ATTRS = new Set([
    "alt", "aria-label", "aria-expanded", "aria-haspopup", "aria-hidden", "role", "href",
    "src", "srcset", "sizes", "type", "name", "value", "placeholder", "checked", "selected",
    "disabled", "viewbox", "preserveaspectratio", "xmlns", "xmlns:xlink", "d", "fill",
    "fill-rule", "fill-opacity", "clip-rule", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
    "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points",
    "width", "height"
  ]);

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 2 && rect.height > 2 && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity) > 0;
  }

  function textOf(element) {
    const aria = element.getAttribute?.("aria-label");
    const alt = element.getAttribute?.("alt");
    const text = aria || alt || element.innerText || element.textContent || element.tagName;
    return String(text).replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function nearestBackground(element) {
    let node = element;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && !/rgba?\(0, 0, 0(?:, 0)?\)|transparent/i.test(color)) return color;
    }
    return "rgb(255, 255, 255)";
  }

  const SECTION_SELECTOR = [
    "section", "[data-section]", "[data-framer-name*='section' i]",
    "main > *", "[role='main'] > *",
    "body > header", "body > nav", "body > footer",
    "header[class]", "footer[class]"
  ].join(",");

  const MIN_SECTION_HEIGHT = 60;

  function semanticSectionRoots() {
    const now = Date.now();
    if (state.sectionRoots && now - state.sectionRootsAt < 1500) return state.sectionRoots;
    const candidates = [...document.querySelectorAll(SECTION_SELECTOR)].filter((candidate) => {
      if (!visible(candidate)) return false;
      if (candidate.closest("x-paper-capture-root")) return false;
      return candidate.getBoundingClientRect().height >= MIN_SECTION_HEIGHT;
    });
    // Only outermost bands survive, so a card marked "section" never outranks the band holding it.
    const roots = candidates.filter((candidate) =>
      !candidates.some((other) => other !== candidate && other.contains(candidate)));
    const ordered = roots.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    state.sectionRoots = ordered;
    state.sectionRootsAt = now;
    return ordered;
  }

  // Site chrome above the first content band keeps the reserved "00", so hero always lands on 01.
  function isChrome(root) {
    const tag = root.tagName.toLowerCase();
    const role = String(root.getAttribute("role") || "").toLowerCase();
    return tag === "header" || tag === "nav" || role === "banner" || role === "navigation";
  }

  function sectionBands() {
    const roots = semanticSectionRoots();
    let start = 0;
    while (start < roots.length && isChrome(roots[start])) start += 1;
    return { chrome: roots.slice(0, start), bands: roots.slice(start) };
  }

  addEventListener("resize", () => { state.sectionRoots = null; }, { passive: true });

  function sectionTopOf(element) {
    return element.getBoundingClientRect().top + scrollY;
  }

  // Every take earns a real band number; "00" is reserved for the chrome above the first band.
  function sectionOf(element) {
    const { chrome, bands } = sectionBands();
    const header = chrome.find((root) => root === element || root.contains(element));
    if (header) return { id: "00", label: "header", root: header };
    if (!bands.length) return { id: "01", label: "page", root: document.body };
    let index = bands.findIndex((root) => root === element || root.contains(element));
    if (index < 0) {
      const top = sectionTopOf(element);
      if (top < sectionTopOf(bands[0])) return { id: "00", label: "header", root: chrome[0] || bands[0] };
      // Unwrapped element (portal, fixed overlay): claim the last band that starts above it.
      for (let cursor = bands.length - 1; cursor >= 0; cursor -= 1) {
        if (sectionTopOf(bands[cursor]) <= top) { index = cursor; break; }
      }
      if (index < 0) index = 0;
    }
    return {
      id: String(index + 1).padStart(2, "0"),
      label: sectionSlug(bands[index], index),
      root: bands[index],
    };
  }

  function sectionSlug(root, index) {
    const heading = root.querySelector("h1,h2,h3,h4,h5,h6");
    const named = root.getAttribute("data-framer-name") || root.getAttribute("data-section") || root.id || "";
    const source = named || (heading ? textOf(heading) : "");
    const slug = String(source).replace(/\s+/g, " ").trim().slice(0, 32);
    const tag = root.tagName.toLowerCase();
    return slug || (["header", "footer", "nav", "aside"].includes(tag) ? tag : `section-${index + 1}`);
  }

  const TYPE_TAGS = {
    img: "Image", picture: "Image", svg: "Image", video: "Media", canvas: "Media",
    input: "Field", textarea: "Field", select: "Field", form: "Form",
    nav: "Nav", ul: "List", ol: "List", table: "Table", header: "Header", footer: "Footer"
  };

  // A generic type beats a text dump: layer names stay scannable and survive copy changes.
  function elementType(element, kind) {
    if (kind === "navbar") return "Navbar";
    if (kind === "dropdown") return "Dropdown";
    const tag = element.tagName.toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "Heading";
    if (TYPE_TAGS[tag]) return TYPE_TAGS[tag];
    if (role === "navigation") return "Nav";
    if (role === "list") return "List";
    if (semanticSectionRoots().includes(element)) return "Section";
    const rect = element.getBoundingClientRect();
    const blocks = [...element.children].filter(visible);
    const display = blocks.find((child) => {
      const size = parseFloat(getComputedStyle(child).fontSize);
      return size >= 36 && /\d/.test(textOf(child));
    });
    if (display && blocks.length <= 3 && rect.height < 320) return "Stat";
    if ((element.querySelector("h1,h2,h3,h4,h5,h6") || blocks.length >= 2) && rect.height >= 100) return "Card";
    if (tag === "button" || role === "button" || tag === "a") return "Button";
    if (["p", "span", "strong", "em", "label"].includes(tag)) return "Text";
    return "Block";
  }

  // Peers share tag and class signature, so a card grid numbers 1..n instead of counting every div.
  function ordinalIn(root, element) {
    const scope = root && root !== element && root.contains(element)
      ? root
      : (element.parentElement || document.body);
    const classes = element.getAttribute("class") || "";
    const peers = [...scope.querySelectorAll(element.tagName)].filter((peer) =>
      visible(peer) && (peer.getAttribute("class") || "") === classes);
    const index = peers.indexOf(element);
    return index >= 0 ? index + 1 : 1;
  }

  function genericLabel(element, kind, section) {
    return `${elementType(element, kind)} ${ordinalIn(section?.root, element)}`;
  }

  const { targetFor } = globalThis.PaperCaptureTargeting;
  const { fingerprintNav, pickNavCandidate } = globalThis.PaperCaptureNavBreakpoints;

  function safeUrl(value) {
    if (!value) return value;
    try { return new URL(value, location.href).href; } catch { return value; }
  }

  function resolveSvgUse(source, budget) {
    const href = source.getAttribute("href") || source.getAttribute("xlink:href") || "";
    let hash = "";
    try { hash = new URL(href, location.href).hash; } catch { hash = href.startsWith("#") ? href : ""; }
    if (!hash) return null;
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep the literal fragment */ }
    const referenced = source.ownerDocument.getElementById(id);
    if (!referenced || referenced === source) return null;
    return cloneInline(referenced, budget);
  }

  function cloneInline(source, budget) {
    if (!source || budget.count >= 520 || budget.chars >= 120000) return null;
    if (source.nodeType === Node.TEXT_NODE) {
      const value = source.nodeValue || "";
      budget.chars += value.length;
      return document.createTextNode(value);
    }
    if (!(source instanceof Element) || SKIP_TAGS.has(source.tagName)) return null;
    if (source.closest("x-paper-capture-root") || source.hasAttribute("data-paper-tool")) return null;
    if (source.tagName === "USE") {
      const resolved = resolveSvgUse(source, budget);
      if (resolved) return resolved;
    }
    budget.count += 1;
    const clone = document.createElement(source.tagName.toLowerCase());
    for (const attr of source.attributes) {
      const name = attr.name.toLowerCase();
      if (!KEEP_ATTRS.has(name) && !name.startsWith("aria-") && !name.startsWith("data-component")) continue;
      let value = attr.value;
      if (name === "src" || name === "href" || name === "srcset") value = safeUrl(value);
      try { clone.setAttribute(attr.name, value); } catch { /* invalid source attr */ }
    }
    const computed = getComputedStyle(source);
    const declarations = [];
    for (const property of STYLE_PROPS) {
      let value = computed.getPropertyValue(property);
      if (!value || value === "normal" && property !== "line-height") continue;
      if (property === "line-height" && /px$/.test(value)) value = "120%";
      if (source === state.hovered && ["position", "transform"].includes(property)) {
        value = property === "position" ? "relative" : "none";
      }
      declarations.push(`${property}:${value}`);
    }
    clone.setAttribute("style", declarations.join(";"));
    for (const child of source.childNodes) {
      const next = cloneInline(child, budget);
      if (next) clone.append(next);
      if (budget.count >= 520 || budget.chars >= 120000) break;
    }
    return clone;
  }

  function serialize(element) {
    state.hovered = element;
    const clone = cloneInline(element, { count: 0, chars: 0 });
    if (!clone) throw new Error("This element could not be serialized");
    clone.setAttribute("layer-name", textOf(element) || element.tagName.toLowerCase());
    clone.style.margin = "0";
    clone.style.position = "relative";
    clone.style.left = "auto";
    clone.style.top = "auto";
    clone.style.transform = "none";
    state.hovered = null;
    return clone.outerHTML;
  }

  function captureData(element, extras = {}) {
    const rect = element.getBoundingClientRect();
    const section = sectionOf(element);
    return {
      id: `take-${Date.now()}-${++state.sequence}`,
      mode: state.mode,
      kind: state.captureKind,
      label: genericLabel(element, state.captureKind, section),
      text: textOf(element),
      tag: element.tagName.toLowerCase(),
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      sectionId: section.id,
      sectionLabel: section.label,
      ancestorBackground: nearestBackground(element),
      navFingerprint: state.captureKind === "navbar" ? fingerprintNav(element) : undefined,
      capturedAt: new Date().toISOString(),
      ...extras,
    };
  }

  function paintedCta(element) {
    if (!visible(element)) return false;
    const nodes = [element, ...element.querySelectorAll("div,span,p,button,a")].slice(0, 16);
    return nodes.some((node) => {
      if (!visible(node)) return false;
      const style = getComputedStyle(node);
      const background = style.backgroundColor;
      const paintedBackground = background && !/rgba?\(0,\s*0,\s*0(?:,\s*0)?\)|transparent/i.test(background);
      const paintedImage = Boolean(style.backgroundImage && style.backgroundImage !== "none");
      const paintedBorder = ["Top", "Right", "Bottom", "Left"].some((side) =>
        Number.parseFloat(style[`border${side}Width`] || "0") > 0);
      return paintedBackground || paintedImage || paintedBorder;
    });
  }

  function tinyMark(node) {
    const rect = node.getBoundingClientRect();
    return rect.width <= 16 && rect.height <= 16;
  }

  function homeHref(link) {
    try {
      const url = new URL(link.href, location.href);
      return url.origin === location.origin
        && (url.pathname === "/" || url.pathname === "" || url.pathname === location.pathname);
    } catch {
      return false;
    }
  }

  function tooLargeForNavbar(element, view = {}) {
    const tag = String(element.tagName || "");
    if (/^(HTML|BODY|MAIN)$/i.test(tag)) return true;
    const rect = element.getBoundingClientRect();
    const vh = Number(view.height) || innerHeight || 900;
    const maxH = Math.min(280, vh * 0.32);
    if (/^(HEADER|SECTION|FOOTER|ARTICLE|NAV)$/i.test(tag) && rect.height > maxH) return true;
    return rect.height > Math.min(360, vh * 0.4);
  }

  function hasLogoEvidence(bar, links) {
    const barRect = bar.getBoundingClientRect();
    const named = "[data-framer-name*='logo' i],[data-framer-name*='brand' i],[aria-label*='logo' i],img[alt*='logo' i]";
    if (bar.matches?.(named) || bar.querySelector(named)) return true;
    const leftLimit = barRect.left + Math.min(280, barRect.width * 0.35);
    const leftmost = [...links].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    if (leftmost) {
      const left = leftmost.getBoundingClientRect().left;
      if (left <= leftLimit && homeHref(leftmost)) return true;
      const mark = leftmost.querySelector("svg,img");
      if (left <= leftLimit && mark && !tinyMark(mark)) return true;
    }
    return [...bar.querySelectorAll("svg,img")].filter(visible).some((mark) => {
      const rect = mark.getBoundingClientRect();
      return rect.left <= leftLimit && !tinyMark(mark);
    });
  }

  function hasMenuControl(bar, barRect) {
    const nodes = [...bar.querySelectorAll("button,[role='button'],[aria-label],[aria-expanded],[aria-controls],[data-framer-name],svg")];
    return nodes.some((node) => {
      if (!visible(node)) return false;
      const box = node.getBoundingClientRect();
      const hint = `${textOf(node)} ${node.getAttribute("aria-label") || ""} ${node.getAttribute("data-framer-name") || ""}`;
      if (/menu|hamburger|burger|nav-?toggle|navigation/i.test(hint)
        && box.width <= 120 && box.height <= 120 && box.width >= 16 && box.height >= 16) {
        return true;
      }
      const rightish = box.left >= barRect.left + barRect.width * 0.55;
      const square = box.width >= 20 && box.width <= 80
        && box.height >= 20 && box.height <= 80
        && Math.abs(box.width - box.height) <= 24;
      const svg = node.tagName === "SVG" ? node : node.querySelector?.("svg");
      return Boolean(rightish && square && svg && !tinyMark(svg));
    });
  }

  function navbarCandidateRows(view = {}) {
    const viewW = Number(view.width) || innerWidth;
    const viewH = Number(view.height) || innerHeight;
    const candidates = new Set();
    for (const landmark of document.querySelectorAll("header,nav,[role='banner'],[role='navigation']")) {
      if (!tooLargeForNavbar(landmark, { height: viewH })) candidates.add(landmark);
    }
    const seeds = document.querySelectorAll("a[href],a,button,[role='button'],[role='link'],img,svg,[aria-haspopup],[data-framer-name*='logo' i],[data-framer-name*='brand' i],[data-framer-name*='menu' i],[data-framer-name*='nav' i],[data-framer-name*='burger' i],[data-framer-name='Phone'],[data-framer-name='Tablet'],[data-framer-name='header-area']");
    for (const seed of seeds) {
      let current = seed;
      for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
        if (tooLargeForNavbar(current, { height: viewH })) break;
        candidates.add(current);
      }
    }
    for (const y of [20, 40, 64, 88]) {
      for (const x of [24, Math.round(viewW / 2), Math.max(24, viewW - 24)]) {
        let stack = [];
        try { stack = document.elementsFromPoint(x, y) || []; } catch { stack = []; }
        for (const seed of stack) {
          if (!(seed instanceof Element)) continue;
          let current = seed;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            if (tooLargeForNavbar(current, { height: viewH })) break;
            candidates.add(current);
          }
        }
      }
    }
    return [...candidates].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      const links = [...element.querySelectorAll("a[href],[role='link']")].filter(visible);
      const buttons = [...element.querySelectorAll("button,[role='button']")].filter(visible);
      const hasLogo = hasLogoEvidence(element, links);
      const hasMenuButton = hasMenuControl(element, rect);
      const logoLinks = new Set(links.filter((link) => {
        const mark = link.querySelector("svg,img");
        const named = /logo|brand/i.test(`${link.getAttribute("data-framer-name") || ""} ${link.getAttribute("aria-label") || ""}`);
        return named || (hasLogo && homeHref(link) && mark && !tinyMark(mark));
      }));
      const navLinks = links.filter((link) => !logoLinks.has(link));
      const ctaNodes = [...element.querySelectorAll("a,button,[role='button'],[data-framer-name*='button' i]")].filter(visible);
      const dropdown = element.querySelector("[aria-haspopup='menu'],[aria-haspopup='true'],[role='menu'],[data-framer-name*='dropdown' i],[data-framer-name*='mega' i]");
      return {
        ...fingerprintNav(element),
        element,
        rect: { top: rect.top, width: rect.width, height: rect.height },
        viewport: { width: viewW, height: viewH },
        hasLogo,
        navLinkCount: navLinks.length,
        hasCta: ctaNodes.some(paintedCta),
        hasDropdown: Boolean(dropdown),
        hasMenuButton,
        interactiveCount: links.length + buttons.length + ctaNodes.length + (hasMenuButton ? 1 : 0),
      };
    });
  }

  function responsiveNavbar(fingerprint, spec = {}) {
    const view = { width: Number(spec.width) || innerWidth, height: Number(spec.height) || innerHeight };
    const rows = navbarCandidateRows(view);
    return pickNavCandidate(rows, fingerprint) || (view.width <= 900 ? pickNavCandidate(rows, {}) : null);
  }

  function autoNavbarTarget() {
    return pickNavCandidate(navbarCandidateRows(), {})?.element || null;
  }

  function semanticData(element) {
    const data = captureData(element);
    return {
      ...data,
      semantic: {
        tag: element.tagName.toLowerCase(),
        text: textOf(element),
        alt: element.getAttribute("alt") || "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        src: element instanceof HTMLImageElement ? element.currentSrc || element.src : "",
        x: Math.round(data.rect.x + scrollX),
        y: Math.round(data.rect.y + scrollY),
        w: Math.round(data.rect.width),
        h: Math.round(data.rect.height),
        sectionId: data.sectionId,
        sectionLabel: data.sectionLabel,
      },
    };
  }

  function semanticElements() {
    const list = document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,ul,ol,img,a,button,form");
    return [...list].filter(visible);
  }

  function clearSemanticOverlays() {
    for (const overlay of state.semanticOverlays.values()) overlay.remove();
    state.semanticOverlays.clear();
  }

  function layoutSemanticOverlays() {
    for (const [element, overlay] of state.semanticOverlays) {
      if (!element.isConnected || !visible(element)) {
        overlay.style.display = "none";
        continue;
      }
      const rect = element.getBoundingClientRect();
      const onScreen = rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
      overlay.style.display = onScreen ? "block" : "none";
      overlay.style.left = `${Math.round(rect.left)}px`;
      overlay.style.top = `${Math.round(rect.top)}px`;
      overlay.style.width = `${Math.round(rect.width)}px`;
      overlay.style.height = `${Math.round(rect.height)}px`;
    }
  }

  function showSemanticOverlays() {
    clearSemanticOverlays();
    for (const element of semanticElements()) {
      const outline = document.createElement("x-paper-semantic-outline");
      const tagChip = document.createElement("x-paper-semantic-chip");
      tagChip.textContent = `<${element.tagName.toLowerCase()}>`;
      outline.append(tagChip);
      root.append(outline);
      state.semanticOverlays.set(element, outline);
    }
    layoutSemanticOverlays();
    return state.semanticOverlays.size;
  }

  function captureIdFor(element) {
    let id = element.getAttribute("data-paper-capture-id");
    if (!id) {
      id = `paper-target-${Date.now()}-${++state.sequence}`;
      element.setAttribute("data-paper-capture-id", id);
    }
    state.selected.set(id, element);
    return id;
  }

  function draw(element) {
    if (!state.recording || !visible(element)) {
      box.style.display = "none";
      return;
    }
    const target = targetFor(element, state.mode, state.captureKind, state.parentDepth);
    const rect = target.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.top)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
    box.style.height = `${Math.round(rect.height)}px`;
    chip.textContent = state.mode === "tags"
      ? `<${target.tagName.toLowerCase()}> · ${textOf(target)}`
      : `${state.captureKind} · ${target.tagName.toLowerCase()} · ${textOf(target)}`;
  }

  function setRecording(recording, mode = state.mode, captureKind = state.captureKind) {
    state.recording = Boolean(recording);
    state.mode = mode;
    state.captureKind = captureKind;
    state.parentDepth = 0;
    status.style.display = state.recording ? "flex" : "none";
    statusText.textContent = `Record · ${captureKind}`;
    document.documentElement.toggleAttribute("data-paper-capture-recording", state.recording);
    if (!state.recording) box.style.display = "none";
    if (state.mode === "tags") showSemanticOverlays();
    else clearSemanticOverlays();
  }

  window.addEventListener("scroll", layoutSemanticOverlays, { passive: true });
  window.addEventListener("resize", layoutSemanticOverlays, { passive: true });

  document.addEventListener("pointermove", (event) => {
    if (!state.recording) return;
    if (event.target !== state.hoverSource) {
      state.hoverSource = event.target;
      state.parentDepth = 0;
    }
    draw(event.target);
  }, true);

  document.addEventListener("keydown", (event) => {
    const editable = event.target instanceof HTMLElement
      && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
    if (editable) return;
    if (state.recording && state.hoverSource && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
      event.preventDefault();
      const before = targetFor(state.hoverSource, state.mode, state.captureKind, state.parentDepth);
      const nextDepth = event.code === "ArrowUp"
        ? Math.min(12, state.parentDepth + 1)
        : Math.max(0, state.parentDepth - 1);
      const after = targetFor(state.hoverSource, state.mode, state.captureKind, nextDepth);
      if (after !== before || event.code === "ArrowDown") state.parentDepth = nextDepth;
      draw(state.hoverSource);
      return;
    }
    if (event.code === "Escape" && state.recording) {
      event.preventDefault();
      setRecording(false);
      chrome.runtime.sendMessage({ type: "HC_RECORDING_CHANGED", recording: false }).catch(() => {});
      return;
    }
    if (event.code !== "KeyR" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    setRecording(!state.recording);
    chrome.runtime.sendMessage({
      type: "HC_RECORDING_CHANGED",
      recording: state.recording,
      mode: state.mode,
      captureKind: state.captureKind,
    }).catch(() => {});
  }, true);

  document.addEventListener("click", (event) => {
    if (!state.recording) return;
    const depth = event.target === state.hoverSource ? state.parentDepth : 0;
    const target = targetFor(event.target, state.mode, state.captureKind, depth);
    if (!target || target.closest("x-paper-capture-root")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setRecording(false);
    chrome.runtime.sendMessage({ type: "HC_RECORDING_CHANGED", recording: false }).catch(() => {});
    if (state.mode === "hover") {
      const captureId = captureIdFor(target);
      chrome.runtime.sendMessage({ type: "HC_HOVER_TARGET", captureId }).catch(() => {});
      return;
    }
    try {
      const capture = state.mode === "tags"
        ? semanticData(target)
        : { ...captureData(target), html: serialize(target) };
      chrome.runtime.sendMessage({ type: "HC_CAPTURED", ok: true, capture }).catch(() => {});
    } catch (error) {
      chrome.runtime.sendMessage({ type: "HC_CAPTURED", ok: false, error: error.message }).catch(() => {});
    }
  }, true);

  function autoTarget(mode, kind) {
    if (mode === "nav" && kind === "navbar") return autoNavbarTarget();
    const selector = mode === "nav"
      ? "nav, header, [role='navigation']"
      : mode === "single"
        ? "button, a, input, img, h1, h2, p"
        : "button, a[href], [role='button'], input[type='submit']";
    return [...document.querySelectorAll(selector)].find(visible) || null;
  }

  function autoHoverTargets() {
    const seen = new Set();
    const candidates = [];
    const list = document.querySelectorAll("button, a[href], [role='button'], input[type='submit']");
    for (const raw of list) {
      const element = interactiveRoot(raw);
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const signature = `${element.tagName}|${textOf(element)}|${Math.round(rect.height)}`;
      const loop = element.closest("[role='list'], ul, ol, [data-framer-name*='Collection'], [data-framer-name*='Grid']");
      if (loop && seen.has(signature)) continue;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const captureId = captureIdFor(element);
      candidates.push({ captureId, label: textOf(element) });
      if (candidates.length >= 12) break;
    }
    return candidates;
  }

  function semanticNodes() {
    return semanticElements().map((element) => semanticData(element).semantic);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;
    if (message.type === "HC_PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_SET_RECORDING") {
      setRecording(message.recording, message.mode, message.captureKind);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_SHOW_TAG_OUTLINES") {
      state.mode = "tags";
      sendResponse({ ok: true, count: showSemanticOverlays() });
      return false;
    }
    if (message.type === "HC_DEACTIVATE") {
      setRecording(false);
      clearSemanticOverlays();
      root.remove();
      delete window.__PAPER_CAPTURE_EXTENSION__;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_PREPARE_TARGET") {
      const element = state.selected.get(message.captureId)
        || document.querySelector(`[data-paper-capture-id="${CSS.escape(message.captureId)}"]`);
      if (!element || !visible(element)) {
        sendResponse({ ok: false, error: "Target disappeared from the page" });
        return false;
      }
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const rect = element.getBoundingClientRect();
      sendResponse({
        ok: true,
        point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      });
      return false;
    }
    if (message.type === "HC_SERIALIZE_TARGET") {
      const element = state.selected.get(message.captureId)
        || document.querySelector(`[data-paper-capture-id="${CSS.escape(message.captureId)}"]`);
      if (!element || !visible(element)) {
        sendResponse({ ok: false, error: "Target disappeared from the page" });
        return false;
      }
      try {
        const capture = { ...captureData(element), html: serialize(element), state: message.state };
        sendResponse({ ok: true, capture, point: capture.point });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return false;
    }
    if (message.type === "HC_CAPTURE_NAV_BREAKPOINT") {
      const spec = message.spec || {};
      const rows = navbarCandidateRows({
        width: Number(spec.width) || innerWidth,
        height: Number(spec.height) || innerHeight,
      });
      const picked = pickNavCandidate(rows, message.fingerprint || {})
        || (Number(spec.width || innerWidth) <= 900 ? pickNavCandidate(rows, {}) : null);
      if (!picked?.element) {
        sendResponse({
          ok: false,
          error: `No safe Navbar match at ${spec.width || innerWidth}px (page ${innerWidth}×${innerHeight}, ${rows.length} candidates)`,
        });
        return false;
      }
      try {
        const width = Number(message.spec?.width || innerWidth);
        const name = String(message.spec?.name || width);
        sendResponse({
          ok: true,
          capture: {
            ...captureData(picked.element),
            id: `navbar-${name}-${Date.now()}-${++state.sequence}`,
            mode: "nav",
            kind: "navbar",
            breakpoint: name,
            contractWidth: width,
            label: `Navbar · ${width}`,
            html: serialize(picked.element),
          },
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return false;
    }
    if (message.type === "HC_AUTO_TARGETS") {
      sendResponse({ ok: true, targets: autoHoverTargets() });
      return false;
    }
    if (message.type === "HC_AUTO_SINGLE") {
      const element = autoTarget(message.mode, message.captureKind);
      if (!element) {
        sendResponse({ ok: false, error: "No visible candidate found" });
        return false;
      }
      try {
        sendResponse({ ok: true, capture: { ...captureData(element), mode: message.mode, kind: message.captureKind, html: serialize(element) } });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return false;
    }
    if (message.type === "HC_AUTO_TAGS") {
      showSemanticOverlays();
      const nodes = semanticNodes();
      for (const overlay of state.semanticOverlays.values()) overlay.classList.add("scanned");
      sendResponse({
        ok: true,
        capture: {
          id: `take-${Date.now()}-${++state.sequence}`,
          mode: "tags",
          kind: "tags-scan",
          label: `Tags scan · ${nodes.length} nodes`,
          url: location.href,
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
          semanticNodes: nodes,
          capturedAt: new Date().toISOString(),
        },
      });
      return false;
    }
    return false;
  });

  setRecording(false);
})();

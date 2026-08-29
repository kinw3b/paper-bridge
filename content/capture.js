(() => {
  if (window.__PAPER_CAPTURE_EXTENSION__) return;
  if (!globalThis.PaperCaptureNaming?.componentName
    || !globalThis.PaperCaptureTargeting?.interactiveRoot
    || !globalThis.PaperCaptureTargeting?.targetFor
    || !globalThis.PaperCaptureNavBreakpoints
    || !globalThis.PaperCaptureSections
    || !globalThis.PaperCaptureTags
    || !globalThis.PaperCaptureSerializeCss
    || !globalThis.PaperCaptureSnapshot?.serialize) {
    return;
  }

  const state = {
    recording: false,
    mode: "dropdown",
    captureKind: "dropdown",
    hovered: null,
    hoverSource: null,
    parentDepth: 0,
    selected: new Map(),
    sequence: 0,
    semanticOverlays: new Map(),
    paperSections: [],
    overlayLoop: 0,
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

  const { componentName } = globalThis.PaperCaptureNaming;
  const { interactiveRoot, targetFor } = globalThis.PaperCaptureTargeting;
  const { fingerprintNav, pickNavCandidate } = globalThis.PaperCaptureNavBreakpoints;
  const tagsApi = globalThis.PaperCaptureTags;
  const cssApi = globalThis.PaperCaptureSerializeCss;

  function layoutPresent(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 2 && rect.height > 2 && style.display !== "none"
      && style.visibility !== "hidden";
  }

  function visible(element) {
    return layoutPresent(element) && Number(getComputedStyle(element).opacity) > 0;
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

  function sectionTopOf(element) {
    return element.getBoundingClientRect().top + scrollY;
  }

  function semanticSectionRoots() {
    const candidates = [...document.querySelectorAll("section, [data-section], [data-framer-name*='section' i]")]
      .filter(visible);
    const siblingGroups = new Map();
    for (const candidate of candidates) {
      const parent = candidate.parentElement;
      if (!parent) continue;
      if (!siblingGroups.has(parent)) siblingGroups.set(parent, []);
      siblingGroups.get(parent).push(candidate);
    }
    const siblings = [...siblingGroups.values()]
      .filter((group) => group.length > 1)
      .sort((a, b) => b.length - a.length)[0];
    const fallback = [...document.querySelectorAll("main > *, [role='main'] > *")].filter(visible);
    const roots = siblings
      || (fallback.length > 1 ? fallback : candidates.filter((candidate) =>
        !candidates.some((other) => other !== candidate && other.contains(candidate))));
    return [...roots].sort((a, b) => sectionTopOf(a) - sectionTopOf(b));
  }

  function sectionOf(element) {
    const mid = sectionTopOf(element) + Math.max(0, element.getBoundingClientRect().height) / 2;
    if (state.paperSections?.length) {
      const hit = globalThis.PaperCaptureSections.matchCensus(mid, state.paperSections);
      if (hit) return hit;
    }
    const { chrome, bands } = globalThis.PaperCaptureSections.contentBands(semanticSectionRoots(), { scrollY });
    const header = chrome.find((root) => root === element || root.contains(element));
    if (header) return { id: "00", label: "header", root: header };
    return globalThis.PaperCaptureSections.assignFromBands(element, bands, {
      scrollY,
      getTop: sectionTopOf,
    });
  }

  function serialize(element) {
    const html = globalThis.PaperCaptureSnapshot.serialize(element, {
      layerName: componentName(element, { kind: state.captureKind }) || element.tagName.toLowerCase(),
      flattenMotion: true,
    });
    if (!html) throw new Error("This element could not be serialized");
    return html;
  }

  function captureData(element, extras = {}) {
    const rect = element.getBoundingClientRect();
    const section = sectionOf(element);
    return {
      id: `take-${Date.now()}-${++state.sequence}`,
      mode: state.mode,
      kind: state.captureKind,
      label: componentName(element, { kind: state.captureKind, mode: state.mode }) || state.captureKind,
      sourceText: textOf(element),
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
    if (!layoutPresent(element)) return false;
    const nodes = [element, ...element.querySelectorAll("div,span,p,button,a")].slice(0, 16);
    return nodes.some((node) => {
      if (!layoutPresent(node)) return false;
      const style = getComputedStyle(node);
      const background = style.backgroundColor;
      const paintedBackground = background && !/rgba?\(0,\s*0,\s*0(?:,\s*0)?\)|transparent/i.test(background);
      const paintedImage = Boolean(style.backgroundImage && style.backgroundImage !== "none");
      const paintedBorder = ["Top", "Right", "Bottom", "Left"].some((side) =>
        Number.parseFloat(style[`border${side}Width`] || "0") > 0);
      const paintedShadow = Boolean(style.boxShadow && style.boxShadow !== "none");
      return paintedBackground || paintedImage || paintedBorder || paintedShadow;
    });
  }

  function pillCta(element) {
    if (!layoutPresent(element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const radius = Math.max(
      Number.parseFloat(style.borderTopLeftRadius) || 0,
      Number.parseFloat(style.borderBottomLeftRadius) || 0,
    );
    return radius >= 8 && rect.height >= 32 && rect.height <= 88 && rect.width >= 72 && rect.width <= 520;
  }

  function tooLargeForHover(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 720 || rect.height > 260) return true;
    return tooLargeForNavbar(element);
  }

  function logoOrImageLink(element) {
    const words = textOf(element).split(/\s+/).filter(Boolean).length;
    const media = element.matches("img,svg") || element.querySelector("img,svg");
    return Boolean(media && words <= 1);
  }

  function inNavChrome(element) {
    return Boolean(element.closest("nav, [role='navigation'], [data-framer-name*='Nav']:not([data-framer-name*='Hero'])"));
  }

  function hoverCta(element) {
    if (!layoutPresent(element) || tooLargeForHover(element) || logoOrImageLink(element)) return false;
    if (element.matches("button, [role='button'], input[type='submit']")) return true;
    if (pillCta(element) || paintedCta(element)) return true;
    const rect = element.getBoundingClientRect();
    const words = textOf(element).split(/\s+/).filter(Boolean).length;
    return !inNavChrome(element) && words > 0 && words <= 8 && rect.height >= 24 && rect.width >= 48;
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

  function semanticData(element, extras = {}) {
    const data = captureData(element);
    const sectionId = extras.sectionId || data.sectionId;
    const path = extras.path;
    return {
      ...data,
      sectionId,
      sectionLabel: extras.sectionLabel || data.sectionLabel,
      semantic: {
        tag: element.tagName.toLowerCase(),
        text: textOf(element),
        alt: element.getAttribute("alt") || "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        src: element instanceof HTMLImageElement ? element.currentSrc || element.src : "",
        role: element.getAttribute("role") || "",
        pcId: extras.pcId || (path ? tagsApi.pcIdFor(sectionId, path) : undefined),
        path,
        x: Math.round(data.rect.x + scrollX),
        y: Math.round(data.rect.y + scrollY),
        w: Math.round(data.rect.width),
        h: Math.round(data.rect.height),
        sectionId,
        sectionLabel: extras.sectionLabel || data.sectionLabel,
      },
    };
  }

  function semanticElements() {
    const list = document.querySelectorAll(
      "h1,h2,h3,h4,h5,h6,p,ul,ol,li,img,a,button,form,label,header,nav,main,footer",
    );
    return [...list].filter(visible);
  }

  function clearSemanticOverlays() {
    stopOverlayLoop();
    for (const overlay of state.semanticOverlays.values()) overlay.remove();
    state.semanticOverlays.clear();
  }

  function layoutSemanticOverlays() {
    for (const [element, overlay] of state.semanticOverlays) {
      if (!element.isConnected || !visible(element)) {
        overlay.style.display = "none";
        continue;
      }
      if (overlay.dataset.attached === "host") {
        overlay.style.display = "block";
        continue;
      }
      const rect = tagsApi.viewportRect(element);
      const onScreen = rect.top + rect.height >= 0 && rect.left + rect.width >= 0
        && rect.top <= innerHeight && rect.left <= innerWidth;
      overlay.style.display = onScreen ? "block" : "none";
      if (onScreen) tagsApi.applyOverlayBox(overlay, rect);
    }
  }

  function stopOverlayLoop() {
    if (state.overlayLoop) cancelAnimationFrame(state.overlayLoop);
    state.overlayLoop = 0;
  }

  function startOverlayLoop() {
    if (state.overlayLoop) return;
    const tick = () => {
      layoutSemanticOverlays();
      state.overlayLoop = state.semanticOverlays.size ? requestAnimationFrame(tick) : 0;
    };
    state.overlayLoop = requestAnimationFrame(tick);
  }

  function showSemanticOverlays() {
    clearSemanticOverlays();
    for (const element of semanticElements()) {
      const outline = document.createElement("x-paper-semantic-outline");
      outline.setAttribute("data-paper-tool", "capture-extension");
      const tagChip = document.createElement("x-paper-semantic-chip");
      tagChip.setAttribute("data-paper-tool", "capture-extension");
      tagChip.textContent = `<${element.tagName.toLowerCase()}>`;
      outline.append(tagChip);
      tagsApi.attachOutline(element, outline, root);
      state.semanticOverlays.set(element, outline);
    }
    layoutSemanticOverlays();
    startOverlayLoop();
    return state.semanticOverlays.size;
  }

  function sectionRootsForWalk() {
    const paper = Array.isArray(state.paperSections) ? state.paperSections : [];
    const fromSelectors = [];
    for (const section of paper) {
      const selector = String(section.selector || "").trim();
      if (!selector) continue;
      let root;
      try { root = document.querySelector(selector); } catch { root = null; }
      if (!root || !visible(root)) continue;
      fromSelectors.push({
        id: String(section.id || "").padStart(2, "0"),
        label: section.slug || section.label || "",
        root,
      });
    }
    if (fromSelectors.length) return fromSelectors;
    const { chrome, bands } = globalThis.PaperCaptureSections.contentBands(semanticSectionRoots(), { scrollY });
    const roots = [];
    for (const node of chrome) roots.push({ id: "00", label: "header", root: node });
    bands.forEach((root, index) => {
      const mid = sectionTopOf(root) + Math.max(0, root.getBoundingClientRect().height) / 2;
      const hit = paper.length ? globalThis.PaperCaptureSections.matchCensus(mid, paper) : null;
      roots.push({
        id: hit?.id && hit.id !== "00" ? hit.id : String(index + 1).padStart(2, "0"),
        label: hit?.label || `section-${index + 1}`,
        root,
      });
    });
    return roots;
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
    const rect = tagsApi.viewportRect(target);
    box.style.display = "block";
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.top)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
    box.style.height = `${Math.round(rect.height)}px`;
    chip.textContent = `${state.captureKind} · ${target.tagName.toLowerCase()} · ${textOf(target)}`;
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
    clearSemanticOverlays();
  }

  window.addEventListener("scroll", layoutSemanticOverlays, { passive: true, capture: true });
  window.addEventListener("resize", layoutSemanticOverlays, { passive: true });
  visualViewport?.addEventListener("scroll", layoutSemanticOverlays, { passive: true });
  visualViewport?.addEventListener("resize", layoutSemanticOverlays, { passive: true });

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
      const capture = { ...captureData(target), html: serialize(target) };
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
    // Walk every Paper band. Page-wide label×size + a first-8 cap kept only
    // nav + hero and dropped later-section CTAs with the same label.
    const seenEl = new Set();
    const bySection = new Map();
    const list = document.querySelectorAll("button, a[href], [role='button'], input[type='submit']");
    for (const raw of list) {
      const element = interactiveRoot(raw);
      if (seenEl.has(element) || !hoverCta(element)) continue;
      const section = sectionOf(element);
      const sectionId = String(section.id || "01").padStart(2, "0");
      if (sectionId === "00" && !pillCta(element) && !paintedCta(element)) continue;
      const rect = element.getBoundingClientRect();
      const signature = `${element.tagName}|${textOf(element)}|${Math.round(rect.height)}`;
      if (!bySection.has(sectionId)) bySection.set(sectionId, { seen: new Set(), items: [] });
      const bucket = bySection.get(sectionId);
      if (bucket.seen.has(signature)) continue;
      bucket.seen.add(signature);
      seenEl.add(element);
      bucket.items.push({
        captureId: captureIdFor(element),
        label: componentName(element, { kind: state.captureKind }),
        sectionId,
      });
    }
    return [...bySection.keys()].sort().flatMap((id) => bySection.get(id).items);
  }

  function pathFromRoot(root, element) {
    const chain = [];
    let node = element;
    while (node && node !== root) {
      const parent = node.parentElement;
      if (!parent) return "";
      const index = [...parent.children].indexOf(node);
      if (index < 0) return "";
      chain.unshift(index);
      node = parent;
    }
    if (node !== root) return "";
    return chain.length ? `0.${chain.join(".")}` : "0";
  }

  function semanticNodes() {
    const roots = sectionRootsForWalk();
    if (!roots.length) return semanticElements().map((element) => semanticData(element).semantic);
    const seen = new Set();
    const nodes = [];
    for (const section of roots) {
      for (const row of tagsApi.walkLayerIds(section.root, section.id, {
        semanticTags: tagsApi.BUILD_TAGS || tagsApi.SEMANTIC_TAGS,
      })) {
        if (!visible(row.element) || seen.has(row.element)) continue;
        seen.add(row.element);
        nodes.push(semanticData(row.element, {
          pcId: row.pcId,
          path: row.path,
          sectionId: row.sectionId,
          sectionLabel: section.label,
        }).semantic);
      }
    }
    for (const element of semanticElements()) {
      if (seen.has(element)) continue;
      const owner = roots.find((section) => section.root.contains(element) || section.root === element);
      const path = owner ? pathFromRoot(owner.root, element) : "";
      nodes.push(semanticData(element, owner && path ? {
        pcId: tagsApi.pcIdFor(owner.id, path),
        path,
        sectionId: owner.id,
        sectionLabel: owner.label,
      } : {}).semantic);
    }
    return nodes;
  }

  function selectedTarget(captureId) {
    return state.selected.get(captureId)
      || document.querySelector(`[data-paper-capture-id="${CSS.escape(captureId)}"]`);
  }

  function freezeMotion(on) {
    const id = "paper-capture-freeze";
    let tag = document.getElementById(id);
    if (on) {
      if (!tag) {
        tag = document.createElement("style");
        tag.id = id;
        tag.textContent = cssApi.freezeMotionStyleText();
        document.documentElement.append(tag);
      }
      document.documentElement.setAttribute("data-paper-capture-freeze", "");
      return;
    }
    document.documentElement.removeAttribute("data-paper-capture-freeze");
    tag?.remove();
  }

  function snapshotOf(element) {
    const nodes = [element, ...element.querySelectorAll("*")].slice(0, 24);
    return nodes.map((node) => cssApi.paintSnapshot(getComputedStyle(node))).join("||");
  }

  function waitPaintRest(element) {
    return new Promise((resolve) => {
      if (!element?.isConnected) {
        resolve({ ok: false, error: "Target disappeared from the page" });
        return;
      }
      let previous = "";
      let stable = 0;
      let frames = 0;
      const tick = () => {
        const now = snapshotOf(element);
        if (now === previous) stable += 1;
        else {
          stable = 0;
          previous = now;
        }
        frames += 1;
        if (cssApi.isPaintRest(previous, now, stable) || frames >= 24) {
          resolve({ ok: true, stable: cssApi.isPaintRest(previous, now, stable), frames });
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;
    if (message.type === "HC_SET_PAPER_SECTIONS") {
      state.paperSections = Array.isArray(message.sections) ? message.sections : [];
      sendResponse({ ok: true, count: state.paperSections.length });
      return false;
    }
    if (message.type === "HC_PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_SET_RECORDING") {
      setRecording(message.recording, message.mode, message.captureKind);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_DEACTIVATE") {
      freezeMotion(false);
      setRecording(false);
      clearSemanticOverlays();
      root.remove();
      delete window.__PAPER_CAPTURE_EXTENSION__;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_FREEZE_MOTION") {
      freezeMotion(Boolean(message.freeze));
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HC_WAIT_PAINT_REST") {
      waitPaintRest(selectedTarget(message.captureId)).then(sendResponse);
      return true;
    }
    if (message.type === "HC_PREPARE_TARGET") {
      const element = selectedTarget(message.captureId);
      if (!element?.isConnected) {
        sendResponse({ ok: false, error: "Target disappeared from the page" });
        return false;
      }
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const rect = element.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) {
        sendResponse({ ok: false, error: "Target disappeared from the page" });
        return false;
      }
      sendResponse({
        ok: true,
        point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      });
      return false;
    }
    if (message.type === "HC_SERIALIZE_TARGET") {
      const element = selectedTarget(message.captureId);
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
    return false;
  });

  setRecording(false);
  window.__PAPER_CAPTURE_EXTENSION__ = true;
})();


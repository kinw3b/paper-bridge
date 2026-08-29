(() => {
  function interactiveRoot(element) {
    return element?.closest?.("a, button, input, select, textarea, [role='button'], [role='link'], [tabindex]")
      || element;
  }

  /** Paper Snapshot only highlights HTMLElement. SVG path/use/svg are never the take root. */
  function htmlHost(element) {
    let node = element;
    while (node && !(node instanceof HTMLElement)) {
      const parent = node.parentElement;
      if (!parent) break;
      node = parent;
    }
    return node || element;
  }

  function parentAtDepth(element, depth = 0) {
    let target = element;
    const steps = Math.max(0, Math.min(12, Number(depth) || 0));
    for (let index = 0; index < steps; index += 1) {
      const parent = target?.parentElement;
      if (!parent || /^(HTML|BODY)$/.test(String(parent.tagName || ""))) break;
      target = parent;
    }
    return target;
  }

  /** Manual Navbar starts exact. Parent promotion happens only via ArrowUp. */
  function targetFor(element, mode, _kind, parentDepth = 0) {
    const host = htmlHost(element);
    const base = mode === "hover" ? interactiveRoot(host) : host;
    return parentAtDepth(base, parentDepth);
  }

  /** Auto/full-navbar capture is the only implicit wrapper lookup. */
  function fullNavbarFor(element) {
    return element?.closest?.("nav, [role='navigation']")
      || element?.closest?.("[data-framer-name*='Nav']:not([data-framer-name*='Hero'])")
      || element;
  }

  globalThis.PaperCaptureTargeting = {
    fullNavbarFor,
    htmlHost,
    interactiveRoot,
    parentAtDepth,
    targetFor,
  };
})();

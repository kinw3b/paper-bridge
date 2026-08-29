(() => {
  const STYLE_PROPS = [
    "display", "position", "box-sizing", "width", "height", "min-width", "min-height",
    "max-width", "max-height", "flex", "flex-direction", "flex-wrap", "flex-grow",
    "flex-shrink", "flex-basis", "align-items", "align-self", "align-content", "justify-content",
    "gap", "row-gap", "column-gap", "grid-template-columns", "grid-template-rows", "grid-auto-flow",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top",
    "margin-right", "margin-bottom", "margin-left", "overflow", "opacity", "visibility",
    "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "background-clip", "border-radius", "outline-offset", "box-shadow",
    "color", "font-family", "font-size", "font-style", "font-weight", "letter-spacing",
    "line-height", "text-align", "text-decoration", "text-transform", "white-space",
    "object-fit", "object-position", "transform", "transform-origin", "filter", "clip-path",
  ];
  const SVG_PAINT_PROPS = [
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-opacity",
    "paint-order", "vector-effect",
  ];

  function isTransparentColor(value) {
    const color = String(value || "").trim().toLowerCase();
    if (!color || color === "transparent" || color === "#0000" || color === "#00000000") return true;
    const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    return Boolean(rgba && rgba[4] != null && Number.parseFloat(rgba[4]) === 0);
  }

  function isNone(value) {
    const next = String(value || "").trim().toLowerCase();
    return !next || next === "none";
  }

  function scaleFromTransform(transform) {
    const value = String(transform || "").trim();
    if (!value || value === "none") return null;
    const matrix3d = value.match(/matrix3d\(([^)]+)\)/i);
    if (matrix3d) {
      const parts = matrix3d[1].split(",").map((part) => Number.parseFloat(part));
      return Math.hypot(parts[0] || 0, parts[1] || 0);
    }
    const matrix = value.match(/matrix\(([^)]+)\)/i);
    if (matrix) {
      const parts = matrix[1].split(",").map((part) => Number.parseFloat(part));
      return Math.hypot(parts[0] || 0, parts[1] || 0);
    }
    const scale = value.match(/scale3d\(([^)]+)\)|scale\(([^)]+)\)/i);
    if (scale) return Number.parseFloat((scale[1] || scale[2] || "").split(",")[0]);
    return null;
  }

  function isFillBlob(facts = {}) {
    return !facts.hasText
      && !facts.hasMedia
      && /^(absolute|fixed)$/.test(String(facts.position || ""))
      && isPaintedFill(facts);
  }

  function isPaintLayer(facts = {}) {
    return isFillBlob(facts) && Boolean(facts.coversParent);
  }

  function isPaintedFill(facts = {}) {
    return !isTransparentColor(facts.backgroundColor)
      || !isNone(facts.backgroundImage);
  }

  function shouldDropPaintLayer(facts = {}) {
    if (isFillBlob(facts) && !facts.coversParent) return true;
    if (!isPaintLayer(facts)) return false;
    if (Number.parseFloat(facts.opacity || "1") < 0.05) return true;
    const scale = scaleFromTransform(facts.transform);
    return scale != null && scale < 0.2;
  }

  function shouldPromoteFill(facts = {}) {
    if (!isPaintLayer(facts) || shouldDropPaintLayer(facts)) return false;
    return isPaintedFill(facts);
  }

  function shadowLayers(value) {
    const text = String(value || "").trim();
    if (!text || text === "none") return [];
    const layers = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) {
        layers.push(text.slice(start, index).trim());
        start = index + 1;
      }
    }
    const last = text.slice(start).trim();
    if (last) layers.push(last);
    return layers;
  }

  function parseShadow(layer) {
    const lengths = [...String(layer).matchAll(/-?[\d.]+px/gi)].map((match) => match[0]);
    const color = String(layer).match(/rgba?\([^)]+\)|hsla?\([^)]+\)|hwb\([^)]+\)|lab\([^)]+\)|oklch\([^)]+\)|color\([^)]+\)|#[0-9a-f]{3,8}/i)?.[0] || "";
    const [x = "0px", y = "0px", blur = "0px", spread = "0px"] = lengths;
    return { layer, x, y, blur, spread, color };
  }

  function splitRingShadows(boxShadow) {
    const rings = [];
    const rest = [];
    for (const layer of shadowLayers(boxShadow)) {
      const shadow = parseShadow(layer);
      const isRing = Math.abs(Number.parseFloat(shadow.x)) < 0.01
        && Math.abs(Number.parseFloat(shadow.y)) < 0.01
        && Math.abs(Number.parseFloat(shadow.blur)) < 0.01
        && Math.abs(Number.parseFloat(shadow.spread)) >= 0.5
        && shadow.color;
      if (isRing) rings.push(shadow);
      else rest.push(layer);
    }
    const ring = rings[0];
    return {
      border: ring ? `${Math.abs(Number.parseFloat(ring.spread))}px solid ${ring.color}` : "",
      boxShadow: rest.join(", "),
    };
  }

  function hasPaintedBorder(computed) {
    return ["top", "right", "bottom", "left"].some((side) => {
      const width = Number.parseFloat(computed.getPropertyValue(`border-${side}-width`) || "0");
      const style = computed.getPropertyValue(`border-${side}-style`);
      return width > 0 && style && style !== "none" && style !== "hidden";
    });
  }

  function overlayComputed(parent, fill) {
    if (!fill) return parent;
    const useFillBorder = !hasPaintedBorder(parent) && hasPaintedBorder(fill);
    return {
      getPropertyValue(name) {
        const value = parent.getPropertyValue(name);
        if (name === "background-color" && isTransparentColor(value)) {
          return fill.getPropertyValue(name) || value;
        }
        if (name === "background-image" && isNone(value)) {
          return fill.getPropertyValue(name) || value;
        }
        if (name === "box-shadow" && isNone(value)) {
          return fill.getPropertyValue(name) || value;
        }
        if (useFillBorder && (name.startsWith("border-") || name.startsWith("outline-"))) {
          return fill.getPropertyValue(name);
        }
        return value;
      },
    };
  }

  function paintDeclarations(computed) {
    const declarations = [];
    const sides = ["top", "right", "bottom", "left"];
    const borders = sides.map((side) => ({
      side,
      width: computed.getPropertyValue(`border-${side}-width`),
      style: computed.getPropertyValue(`border-${side}-style`),
      color: computed.getPropertyValue(`border-${side}-color`),
    })).filter((border) => Number.parseFloat(border.width) > 0
      && border.style && border.style !== "none" && border.style !== "hidden");
    if (borders.length === 4 && borders.every((border) => border.width === borders[0].width
      && border.style === borders[0].style && border.color === borders[0].color)) {
      // Paper reliably imports `border`, unlike individual border edge properties.
      declarations.push(`border:${borders[0].width} ${borders[0].style} ${borders[0].color}`);
    } else {
      for (const border of borders) {
        declarations.push(`border-${border.side}:${border.width} ${border.style} ${border.color}`);
      }
    }
    const outlineWidth = computed.getPropertyValue("outline-width");
    const outlineStyle = computed.getPropertyValue("outline-style");
    const outlineColor = computed.getPropertyValue("outline-color");
    if (Number.parseFloat(outlineWidth) > 0 && outlineStyle && outlineStyle !== "none" && outlineStyle !== "hidden") {
      declarations.push(`outline:${outlineWidth} ${outlineStyle} ${outlineColor}`);
    }
    return declarations;
  }

  function layoutDeclarations(computed) {
    const sides = ["top", "right", "bottom", "left"].map((side) => ({
      side,
      value: computed.getPropertyValue(side),
    })).filter((item) => item.value && item.value !== "auto");
    const declarations = [];
    if (sides.length === 4 && sides.every((item) => item.value === sides[0].value)) {
      declarations.push(`inset:${sides[0].value}`);
    } else {
      for (const item of sides) declarations.push(`${item.side}:${item.value}`);
    }
    const zIndex = computed.getPropertyValue("z-index");
    if (zIndex && zIndex !== "auto") declarations.push(`z-index:${zIndex}`);
    return declarations;
  }

  function freezeMotionStyleText() {
    return `html[data-paper-capture-freeze] *,html[data-paper-capture-freeze] *::before,html[data-paper-capture-freeze] *::after{transition:none !important;animation:none !important;animation-delay:0s !important;}`;
  }

  function paintSnapshot(computed) {
    return [
      computed.getPropertyValue("transform"),
      computed.getPropertyValue("opacity"),
      computed.getPropertyValue("background-color"),
      computed.getPropertyValue("box-shadow"),
      computed.getPropertyValue("width"),
      computed.getPropertyValue("height"),
      computed.getPropertyValue("top"),
      computed.getPropertyValue("right"),
      computed.getPropertyValue("bottom"),
      computed.getPropertyValue("left"),
    ].join("|");
  }

  function isPaintRest(previous, next, stableCount) {
    return previous === next && Number(stableCount) >= 2;
  }

  function pseudoContentText(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "none" || raw === "normal") return { generated: false, text: "" };
    const primary = raw.split(" / ")[0];
    const text = [...primary.matchAll(/(['"])(.*?)\1/g)].map((match) => match[2]).join("");
    return { generated: true, text };
  }

  function isCollapsedPseudo(computed) {
    const position = computed.getPropertyValue("position");
    if (!/^(absolute|fixed)$/.test(position)) return false;
    const transform = computed.getPropertyValue("transform") || "";
    if ([
      "matrix(0, 0, 0, 1, 0, 0)",
      "matrix(0, 0, 0, 0, 0, 0)",
      "scaleX(0)",
      "scale(0)",
      "scaleY(0)",
    ].includes(transform)) return true;
    const scale = scaleFromTransform(transform);
    return scale != null && scale < 0.2;
  }

  function hasPseudoPaint(computed) {
    if (hasPaintedBorder(computed)) return true;
    if (!isTransparentColor(computed.getPropertyValue("background-color"))) return true;
    if (!isNone(computed.getPropertyValue("background-image"))) return true;
    if (!isNone(computed.getPropertyValue("box-shadow"))) return true;
    const outlineWidth = Number.parseFloat(computed.getPropertyValue("outline-width") || "0");
    const outlineStyle = computed.getPropertyValue("outline-style");
    return outlineWidth > 0 && Boolean(outlineStyle) && outlineStyle !== "none" && outlineStyle !== "hidden";
  }

  function shouldMaterializePseudo(computed) {
    const content = pseudoContentText(computed.getPropertyValue("content"));
    if (!content.generated) return false;
    if (isCollapsedPseudo(computed)) return false;
    if (Number.parseFloat(computed.getPropertyValue("opacity") || "1") < 0.05) return false;
    return Boolean(content.text) || hasPseudoPaint(computed);
  }

  function styleAttribute(computed, { flattenMotion = false, fillComputed = null, hugHeight = false, svg = false } = {}) {
    const source = overlayComputed(computed, fillComputed);
    const declarations = [];
    const rings = splitRingShadows(source.getPropertyValue("box-shadow"));
    const props = svg ? STYLE_PROPS.concat(SVG_PAINT_PROPS) : STYLE_PROPS;
    for (const property of props) {
      if (property === "box-shadow") continue;
      if (hugHeight && ["height", "min-height", "max-height"].includes(property)) continue;
      let value = source.getPropertyValue(property);
      if (!value) continue;
      if (value === "normal" && property !== "line-height") continue;
      if (property === "line-height" && /px$/.test(value)) value = "120%";
      if (property === "background-color" && isTransparentColor(value)) continue;
      if (property === "background-image" && isNone(value)) continue;
      if (property === "filter" && isNone(value)) continue;
      if (flattenMotion && ["position", "transform"].includes(property)) {
        value = property === "position" ? "relative" : "none";
      }
      declarations.push(`${property}:${value}`);
    }
    const painted = paintDeclarations(source);
    declarations.push(...painted);
    if (rings.border && !painted.some((decl) => decl.startsWith("border:") || decl.startsWith("border-"))) {
      declarations.push(`border:${rings.border}`);
    }
    if (rings.boxShadow) declarations.push(`box-shadow:${rings.boxShadow}`);
    declarations.push(...layoutDeclarations(source));
    return declarations.join(";");
  }

  function materializePseudo(computed) {
    if (!shouldMaterializePseudo(computed)) return null;
    return {
      text: pseudoContentText(computed.getPropertyValue("content")).text,
      style: styleAttribute(computed),
    };
  }

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

  function shouldRewriteCapturedUrl(name, value, isSvg = false) {
    const attr = String(name || "").toLowerCase();
    if (attr !== "src" && attr !== "srcset" && attr !== "href") return false;
    if (attr === "href" && (isSvg || String(value || "").startsWith("#"))) return false;
    return true;
  }

  globalThis.PaperCaptureSerializeCss = {
    STYLE_PROPS,
    paintDeclarations,
    layoutDeclarations,
    freezeMotionStyleText,
    paintSnapshot,
    isPaintRest,
    styleAttribute,
    splitRingShadows,
    shouldPromoteFill,
    shouldDropPaintLayer,
    isTransparentColor,
    pseudoContentText,
    shouldMaterializePseudo,
    materializePseudo,
    svgHrefId,
    shouldRewriteCapturedUrl,
    SVG_PAINT_PROPS,
  };
})();

# Handoff — stamp stable layer ids during step 1.2 serialization

**For a session in `~/.claude/skills/url-to-paper/`.**
Requested by the Paper Capture Tool (`~/Documents/Extension/paper-bridge`), which
consumes the result in its Tags step.

## Problem

The Tags step of Paper Capture Tool collects a semantic census of the live page
(`<h1>`, `<p>`, `<img>`, `<a>`, …) and renames the matching Paper layers to
`tag · text` (e.g. `h1 · Create your workspace & make life easier.`).

It has no reliable way to know *which* Paper layer corresponds to which DOM
element, because `scripts/serializer.js` emits no layer names. Paper therefore
auto-names everything `Frame` / `Rectangle` / `Text`.

Four matching strategies were tried in the extension and all are dead ends:

| Strategy | Result |
|---|---|
| Section index (`01 ·` band) | DOM bands ≠ pipeline sections; hero lives in `<header>` so numbering is offset by 2 |
| Exact + fuzzy text | 86 / 278. Cannot match `<img>` (no text); breaks on duplicate copy (nav vs hero "Get Started Now") |
| Absolute page geometry | Paper's rebuild has its own padding; coords never align |
| Per-section calibrated geometry | Offsets drift down the page; still ~86 |

## Fix

Carry a stable key end-to-end instead of guessing.

Paper's `write_html` honors `layer-name`, `data-name`, and `data-paper-name` and
uses them as the layer name. The pipeline already relies on this for bands
(`01 · nav`), confirmed in `web2html/scripts/paper_layer_names.py:273`.

### 1. Stamp ids in `scripts/serializer.js`

Every serialized element gets a stable key derived from its position in the tree:

```html
<div layer-name="pc-0.2.1.4" ...>
```

Child-index path from the section root. `data-framer-name` was considered and
rejected — not present on every node and not unique.

### 2. Emit a sidecar map

Alongside the serialized HTML, write `pc-id → { tag, text, section }` so the
mapping is inspectable and diffable.

### 3. Re-import

Re-run 1.2 so `home-desktop` is built with those layer names.

### 4. Extension side (already scoped, not yet written)

`bridge/semantics.mjs` computes the same path for each census element and renames
by exact lookup. All text matching, geometry scoring, and offset calibration get
deleted. Result is 278/278 or a visible hard failure — no silent partial match.

## Open decision

New artboard (`home-desktop-v2`) or replace `home-desktop`?
Replacing discards the 86 layers already renamed plus any manual edits.

## Constraint

The path key must be computed identically at serialization time and at scan time,
so the live DOM must not change between the import and the Tags scan.

## Context

- Paper file: `01M0GPEFVQ1A4G5E078T82CNDW` (`kp-frilly`)
- Project root: `/Users/neff/Documents/Playground/Templates/kp-frilly`
- Current artboard: `home-desktop` (`1K-0`), 1600px wide, 10 sections `01 · hero-area` … `10 · footer`
- Diagnostics from the last scan: `qa/paper-semantics-debug.json`
- Census: `qa/source-semantics.json`

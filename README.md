# Paper Capture Tool · Chrome extension

This is the developer preview of the Capture Tool as a proper Manifest V3
Chrome extension. It runs in your normal browser as a side panel and uses a
small local bridge to wait for real Paper write receipts.

## Install on macOS

1. Unzip the package somewhere you will keep it.
2. Double-click `install-native-host.command`. If macOS blocks it, right-click
   it and choose **Open**. The installer requires Node.js 18 or newer.
3. Restart Google Chrome.
4. Open `chrome://extensions`.
5. Turn **Developer mode** on.
6. Click **Load unpacked** and select this unzipped folder — the folder that
   contains `manifest.json`.
7. Pin **Paper Capture Tool** to the Chrome toolbar.

The package has a fixed development extension ID:
`ecicfkapebfbpdgfaiadgfcghkpgmbem`. The installer grants native bridge access
only to that extension ID.

## Run the first test

1. Open Paper Desktop and the Paper file that already contains (or should
   contain) the `Navigation`, `Hover States`, and `Components` frames.
2. In your primary Chrome window, open the source URL.
3. Click the **Paper Capture Tool** toolbar icon. The side panel opens.
4. Paste the Paper file ID and the absolute project folder, then click
   **Start capture**. The extension creates missing review frames, but never
   creates a Design Library.
5. In **Navbar + Dropdowns**, leave `Navbar` selected and click **Record**.
   Hover begins on the exact DOM node under the pointer. Press **↑** to climb
   one parent or **↓** to move back toward the original node, then click the
   wrapper you actually want. Auto deliberately selects the first full navbar.
   The serialized component contains only that selected root and its real
   descendants—no synthetic context frame. SVG symbol references and computed
   borders/outlines are preserved for Paper.
6. Wait while Capture Tool opens inactive background tabs at 768 and 390,
   rematches the desktop Navbar selection, and sends all three versions to
   `Navigation`. Continue unlocks only after Paper confirms Desktop, Tablet,
   and Mobile. The progress card shows capture/confirmation state and `n/3`;
   the locked button displays its wait, then unlocks automatically at `3/3`.
   A failed width says Retry needed. No viewport switches or second visible
   Chrome window are used.
7. If the page has a dropdown, select `Dropdown`:
   - Record the closed state.
   - Open the dropdown normally on the page.
   - For a hover-open menu, keep the pointer on the page and press **R** so the
     menu does not close; then click the open menu wrapper to record state two.
8. In **Tags**, semantic outlines and `<tag>` pills appear automatically and
   follow the page as you scroll. The action button is **Scan**, not Record;
   Auto still uses that explicit Scan action. These overlays are capture-tool
   chrome and are excluded from serialized HTML.
   Scan does not add a Tags/pill specimen to Paper. It updates existing layers
   inside `home-desktop` with semantic names such as `a · Free Consultation` or
   `h1 · High quality…`. Links/buttons tag their enclosing interactive frame,
   not merely the text leaf, so design-to-code can infer the correct element.
8. Click **Continue** and test Hover, Multi-state, Single, and Tags.
9. Click **Done** only on Tags. It closes the capture session and writes
   `source-site/components/human-hover-done.json`.

## Auto mode

- Navbar: chooses the first visible navigation landmark.
- Hover: walks up to eight unique visible controls with trusted Chrome pointer
  events and skips repeated list/grid patterns.
- Single: chooses the first visible exact object candidate.
- Tags: scans visible semantic elements as one reviewed batch.
- Dropdown and Multi-state remain manual because an extension should not invent
  or guess a component's open state.

## What gets written

- Paper `Navigation`: the selected desktop Navbar, its automatic 768 and 390
  responsive matches, and any dropdown pairs.
- Paper `Hover States`: default/hover pairs.
- Paper `Components`: Multi-state, Single, and Tags review receipts.
- Confirmed-take wrappers and state cells hug the intrinsic serialized content
  size instead of inheriting the review-board width.
- Disk `source-site/components/home/*`: Paper-ready HTML and manifests.
- Disk `qa/source-semantics.*`: the Tags census.
- Disk `source-site/components/human-hover-done.json`: the 1.3 hard-stop receipt.

## Troubleshooting

- **Native host not found:** rerun `install-native-host.command`, fully quit and
  reopen Chrome, then reload the extension.
- **Paper unavailable:** keep Paper Desktop open and verify the file ID. The
  default endpoint is `http://127.0.0.1:29979/mcp`.
- **Debugger already attached:** close DevTools on the source tab. Hover and
  Auto Hover use Chrome's debugger permission for trusted pointer movement;
  responsive Navbar capture uses it on two inactive tabs.
- **File URL:** enable **Allow access to file URLs** on the extension details
  page if the source is a local `file://` page.
- **Red failed take:** no green check was issued. Fix Paper or the bridge and
  click **Retry**; the take ID is idempotent.

To remove the bridge, double-click `uninstall-native-host.command`, then remove
the unpacked extension from `chrome://extensions`.

# Paper Bridge

Chrome extension for the [web2html](https://web2html.com) pipeline.

**This is not a standalone tool.** It is the Capture Tool used in step 1.3 of the web2html skill — the human pass that records navbar, dropdown, hover, component, and tag states from a live page into [Paper](https://paper.design). Use it with the skill, not on its own.

- Skill: [web2html.com](https://web2html.com) · [`npx github:kinw3b/web2html-skill`](https://github.com/kinw3b/web2html-skill)
- Requires [Paper Desktop](https://paper.design/downloads) and an active web2html run

## Install (macOS)

Needs Node.js 18+ and Google Chrome.

1. Clone this repo and keep the folder somewhere stable.
2. Double-click `install-native-host.command`. If macOS blocks it, right-click → **Open**.
3. Fully quit and reopen Chrome.
4. Go to `chrome://extensions`, turn on **Developer mode**, then **Load unpacked** and select this folder (the one with `manifest.json`).
5. Pin **Paper Capture Tool**.

Fixed development ID: `ecicfkapebfbpdgfaiadgfcghkpgmbem`. The native host only talks to that ID.

## How it is used

The web2html skill opens this panel during a run. You record the live page; the skill waits for **Done**, then continues the pipeline. Do not start a capture session outside that flow — destinations, file IDs, and receipts all come from the skill.

## Versioning

Release tags match `manifest.json` `version` (for example `1.2.23`). Tag the commit that ships that version; do not reuse a tag.

```bash
git tag -a 1.2.23 -m "Paper Capture Tool 1.2.23"
git push origin 1.2.23
```

## Uninstall

Double-click `uninstall-native-host.command`, then remove the unpacked extension from `chrome://extensions`.

#!/bin/sh
set -eu

EXTENSION_ID="ecicfkapebfbpdgfaiadgfcghkpgmbem"
HOST_NAME="com.kreativepro.paper_capture"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_BIN=$(command -v node || true)

if [ -z "$NODE_BIN" ]; then
  printf '%s\n' "Node.js 18 or newer is required for the Paper bridge." >&2
  printf '%s\n' "Install Node.js, then run this installer again." >&2
  exit 1
fi

NODE_MAJOR=$($NODE_BIN -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf '%s\n' "Node.js 18 or newer is required (found $($NODE_BIN -v))." >&2
  exit 1
fi

INSTALL_DIR="$HOME/Library/Application Support/Paper Capture Tool"
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_COPY="$INSTALL_DIR/host.mjs"
SEMANTICS_COPY="$INSTALL_DIR/semantics.mjs"
LAUNCHER="$INSTALL_DIR/run-paper-capture-host"
MANIFEST="$CHROME_DIR/$HOST_NAME.json"

mkdir -p "$INSTALL_DIR" "$CHROME_DIR"
cp "$SCRIPT_DIR/bridge/host.mjs" "$HOST_COPY"
cp "$SCRIPT_DIR/bridge/semantics.mjs" "$SEMANTICS_COPY"
chmod 700 "$HOST_COPY" "$SEMANTICS_COPY"

{
  printf '%s\n' '#!/bin/sh'
  printf 'exec "%s" "%s"\n' "$NODE_BIN" "$HOST_COPY"
} > "$LAUNCHER"
chmod 700 "$LAUNCHER"

{
  printf '%s\n' '{'
  printf '  "name": "%s",\n' "$HOST_NAME"
  printf '%s\n' '  "description": "Paper Capture Tool local bridge",'
  printf '  "path": "%s",\n' "$LAUNCHER"
  printf '%s\n' '  "type": "stdio",'
  printf '  "allowed_origins": ["chrome-extension://%s/"]\n' "$EXTENSION_ID"
  printf '%s\n' '}'
} > "$MANIFEST"

printf '\n%s\n' "✓ Paper Capture Tool bridge installed."
printf '%s\n' "Extension ID: $EXTENSION_ID"
printf '%s\n' "Restart Chrome, open chrome://extensions, turn on Developer mode,"
printf '%s\n' "choose Load unpacked, and select:"
printf '  %s\n\n' "$SCRIPT_DIR"
printf '%s' "Press Return to close…"
read _unused

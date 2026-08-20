#!/bin/sh
set -eu

HOST_NAME="com.kreativepro.paper_capture"
INSTALL_DIR="$HOME/Library/Application Support/Paper Capture Tool"
MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"

if [ -f "$MANIFEST" ]; then mv "$MANIFEST" "$HOME/.Trash/$HOST_NAME.json"; fi
if [ -d "$INSTALL_DIR" ]; then mv "$INSTALL_DIR" "$HOME/.Trash/Paper Capture Tool"; fi

printf '\n%s\n' "✓ Paper Capture Tool bridge moved to Trash."
printf '%s\n' "Remove the unpacked extension from chrome://extensions to finish."
printf '%s' "Press Return to close…"
read _unused

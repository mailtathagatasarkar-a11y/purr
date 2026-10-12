#!/bin/bash
# Installs (or updates) Purr on macOS from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/mailtathagatasarkar-a11y/purr/main/install.sh | bash
#
# Files downloaded by curl aren't marked as "downloaded from the internet", so
# macOS doesn't show the "Purr Not Opened" warning that a browser download gets.
# Purr isn't notarized by Apple because that needs a paid developer account;
# this script is the free way around it. Read it before you run it.
set -euo pipefail

REPO="mailtathagatasarkar-a11y/purr"
DEST="/Applications/Purr.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, download Purr-Setup from https://github.com/$REPO/releases/latest"
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Unsupported Mac processor: $(uname -m)"; exit 1 ;;
esac
# A Terminal running under Rosetta reports x86_64 on Apple Silicon; prefer the native build.
if [ "$ARCH" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  ARCH=arm64
fi

echo "Finding the latest Purr for $ARCH..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "\"browser_download_url\": *\"[^\"]*-$ARCH\.zip\"" \
  | head -n 1 \
  | sed -E 's/.*"(https[^"]*)"$/\1/')
if [ -z "$URL" ]; then
  echo "Couldn't find a Mac download for $ARCH yet. Check https://github.com/$REPO/releases"
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $(basename "$URL")..."
curl -fL --progress-bar -o "$TMP/purr.zip" "$URL"
ditto -x -k "$TMP/purr.zip" "$TMP/unpacked"
if [ ! -d "$TMP/unpacked/Purr.app" ]; then
  echo "The download didn't contain Purr.app. Nothing was changed."
  exit 1
fi

if pgrep -x Purr >/dev/null 2>&1; then
  echo "Closing the running Purr..."
  osascript -e 'quit app "Purr"' >/dev/null 2>&1 || true
  sleep 2
fi

echo "Installing to $DEST..."
if [ -w /Applications ]; then
  rm -rf "$DEST"
  ditto "$TMP/unpacked/Purr.app" "$DEST"
else
  echo "(macOS will ask for your password to write to /Applications.)"
  sudo rm -rf "$DEST"
  sudo ditto "$TMP/unpacked/Purr.app" "$DEST"
fi
# In case the zip carried the flag anyway.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "Purr is installed. Opening it now."
echo "When it asks, allow Microphone and Accessibility in System Settings."
open "$DEST"

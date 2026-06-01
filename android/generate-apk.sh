#!/bin/bash
# ─────────────────────────────────────────────────────────────
# WardrobeAI Android APK Generator
# ─────────────────────────────────────────────────────────────
# This script generates a signed Android APK using Bubblewrap TWA.
# Run this script INTERACTIVELY in your terminal (not from an IDE).
#
# Prerequisites:
#   - Node.js 18+
#   - npm install -g @bubblewrap/cli
#
# Usage:
#   cd android/
#   chmod +x generate-apk.sh
#   ./generate-apk.sh
# ─────────────────────────────────────────────────────────────

set -e

FRONTEND_URL="https://wardrobeai-frontend-959058619084.asia-south1.run.app"
MANIFEST_URL="${FRONTEND_URL}/manifest.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WardrobeAI — Android APK Generator (TWA)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Frontend URL: ${FRONTEND_URL}"
echo "Manifest URL: ${MANIFEST_URL}"
echo ""

# Check bubblewrap
if ! command -v bubblewrap &> /dev/null; then
    echo "Installing @bubblewrap/cli..."
    npm install -g @bubblewrap/cli
fi

echo "Bubblewrap version: $(bubblewrap --version)"
echo ""

# Step 1: Initialize the project
echo "Step 1: Initializing TWA project from manifest..."
echo "  When prompted:"
echo "    - JDK: Say YES to let Bubblewrap install it (or NO if you have JDK 17)"
echo "    - Android SDK: Say YES to let Bubblewrap install it"
echo "    - Package ID: com.wardrobeai.app"
echo "    - Accept defaults for most settings"
echo "    - For keystore password: choose any password you'll remember"
echo ""
read -p "Press Enter to start initialization..."

bubblewrap init --manifest="${MANIFEST_URL}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Building the APK..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

bubblewrap build

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BUILD COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Files generated:"
echo "  APK:  ./app-release-signed.apk  (install on phone)"
echo "  AAB:  ./app-release-bundle.aab  (upload to Play Store)"
echo "  DAL:  ./assetlinks.json         (deploy to .well-known/)"
echo ""
echo "To install on your phone:"
echo "  1. Transfer app-release-signed.apk to your phone"
echo "  2. Open the APK file on your phone"
echo "  3. Allow installation from unknown sources"
echo "  4. Install and open the app"
echo ""
echo "For Chrome to show your app without the URL bar,"
echo "deploy assetlinks.json to:"
echo "  ${FRONTEND_URL}/.well-known/assetlinks.json"
echo ""

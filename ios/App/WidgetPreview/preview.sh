#!/bin/bash
# Build and run the Mac widget preview (seconds): ios/App/WidgetPreview/preview.sh [out.png]
set -euo pipefail
cd "$(dirname "$0")/.."
swiftc -Onone -target arm64-apple-macos15 Widget/Shared/*.swift WidgetPreview/main.swift -o /tmp/widget-preview-bin 2>&1 | grep -v "warning:" | grep -v "^\s*|" || true
/tmp/widget-preview-bin "${1:-/tmp/widget-preview.png}"

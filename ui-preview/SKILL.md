---
description: Capture and visually verify UI changes using Playwright screenshot
---

# ui-preview

Captures a screenshot of the current UI state (HTML file or localhost) and analyzes it visually to verify changes.

## Usage

```
/ui-preview [url_or_path] [options]
```

**Arguments:**
- `url_or_path` (optional): URL (http://localhost:3000) or file path (./index.html). Defaults to file://$(pwd)/index.html
- `--port <number>`: Shorthand for localhost:port (e.g., `--port 3000`)
- `--full-page`: Capture full scrollable page (default: true)
- `--wait <ms>`: Wait before capturing (default: 1000ms)
- `--viewport <width>x<height>`: Set viewport size (default: 1920x1080)

## Examples

```bash
# Capture current directory's index.html
/ui-preview

# Capture from localhost
/ui-preview http://localhost:3000
/ui-preview --port 5173

# Capture with custom viewport
/ui-preview --port 3000 --viewport 375x667

# Capture specific file
/ui-preview ./dist/about.html
```

## Behavior

1. Captures screenshot using Playwright
2. Saves to ~/os/tmp/ui-verify-<timestamp>.png
3. Automatically reads and analyzes the screenshot
4. Reports on visual state and any issues found

## Implementation

```bash
#!/bin/bash
set -euo pipefail

# Parse arguments
URL=""
PORT=""
VIEWPORT="1920,1080"
WAIT="1000"
FULL_PAGE="--full-page"

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      PORT="$2"
      shift 2
      ;;
    --viewport)
      VIEWPORT="${2/x/,}"
      shift 2
      ;;
    --wait)
      WAIT="$2"
      shift 2
      ;;
    --no-full-page)
      FULL_PAGE=""
      shift
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

# Determine URL
if [[ -n "$PORT" ]]; then
  URL="http://localhost:$PORT"
elif [[ -z "$URL" ]]; then
  URL="file://$(pwd)/index.html"
elif [[ "$URL" != http* ]] && [[ "$URL" != file://* ]]; then
  # Convert relative path to file:// URL
  if [[ "$URL" = /* ]]; then
    URL="file://$URL"
  else
    URL="file://$(pwd)/$URL"
  fi
fi

# Create output path
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$HOME/os/tmp"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/ui-verify-$TIMESTAMP.png"

echo "📸 Capturing screenshot from: $URL"
echo "💾 Saving to: $OUTPUT_FILE"

# Capture screenshot
playwright screenshot \
  $FULL_PAGE \
  --viewport-size "$VIEWPORT" \
  --wait-for-timeout "$WAIT" \
  --ignore-https-errors \
  "$URL" \
  "$OUTPUT_FILE"

echo "✅ Screenshot captured successfully"
echo ""
echo "🔍 Analyzing screenshot..."
echo "---"
echo "SCREENSHOT_PATH: $OUTPUT_FILE"
```

## Integration with UI Development Workflow

When working on UI tasks, use this skill after making changes:

1. Make UI changes to HTML/CSS/JS
2. Run `/ui-preview` (or with specific URL/port)
3. Claude analyzes the screenshot visually
4. Claude reports findings and suggests fixes if needed
5. Iterate until verified

This eliminates manual screenshot sharing and creates a tight feedback loop.

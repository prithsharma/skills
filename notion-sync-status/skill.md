---
name: notion-sync-status
description: Show sync status for all Notion-synced files. Displays which files are synced, modified, or have conflicts.
disable-model-invocation: false
---

Show sync status for all files tracked in the Notion sync manifest.

## Arguments

- **File path** (optional): Show status for specific file only
- **Verbose** (optional): `--verbose` or `-v` to show detailed information

## What to do

1. **Load manifest:**
   - Read `~/.notion-sync/manifest.json`
   - Get all tracked files

2. **For each file (or single file if specified):**
   - Check if file exists locally
   - Read file content and frontmatter
   - Compute current content hash
   - Load entry from manifest
   - Determine status:
     - **synced**: Local and Notion hashes match manifest
     - **local_modified**: Local hash differs from manifest
     - **notion_modified**: Notion hash differs from manifest (need to fetch to confirm)
     - **conflict**: Both local and Notion changed since last sync
     - **not_found**: File doesn't exist locally but is in manifest
     - **not_synced**: File exists but not in manifest

3. **Status determination logic:**
   ```
   local_hash = hash(current file content)
   manifest_local_hash = entry.local_hash
   manifest_notion_hash_at_sync = entry.notion_hash_at_sync

   if file doesn't exist:
     status = "not_found"
   else if local_hash == manifest_local_hash:
     status = "synced"  // (or "notion_modified" if we fetch and Notion changed)
   else:
     // Local has changed
     // To know if it's a conflict, we'd need to fetch Notion
     // For quick status, just show "local_modified"
     status = "local_modified"
   ```

4. **Display status:**

   **Compact view (default):**
   ```
   Notion Sync Status
   ==================

   ✓ synced           docs/api-reference.md
   ✓ synced           docs/planning.md
   ⚠ local_modified   docs/architecture.md
   ✗ not_found        docs/old-doc.md

   Summary: 2 synced, 1 modified, 1 not found

   Use /push-notion <file> to push local changes to Notion
   Use /pull-notion <notion-url> to pull updates from Notion
   ```

   **Verbose view (`--verbose`):**
   ```
   Notion Sync Status
   ==================

   File: docs/api-reference.md
   Status: ✓ synced
   Notion ID: abc123def456
   Last synced: 2026-03-27T10:30:00Z
   Local hash: a1b2c3...
   Notion hash: a1b2c3...
   ---

   File: docs/architecture.md
   Status: ⚠ local_modified
   Notion ID: def456abc123
   Last synced: 2026-03-26T15:20:00Z
   Local hash: d4e5f6... (current)
   Manifest hash: a1b2c3... (at sync)
   Changes: Content modified locally since last sync
   Action: Run /push-notion docs/architecture.md
   ---
   ```

5. **For single file status:**
   - Show detailed information even without --verbose
   - Include Notion page URL
   - Show suggested next action

6. **Summary statistics:**
   - Count files by status
   - Show total synced files
   - Highlight any conflicts or issues

## Status indicators

- `✓` - Synced (green)
- `⚠` - Modified locally (yellow)
- `⚡` - Conflict (red)
- `✗` - Not found (red)
- `○` - Not yet synced (gray)

## Important notes

- Quick status check doesn't fetch from Notion (would be slow)
- To detect Notion-side changes, you'd need to run a full sync check
- Conflicts are only definitively detected during push operation
- Use this command before starting work to see what needs syncing

## Example usage

```
/notion-sync-status
/notion-sync-status docs/api-reference.md
/notion-sync-status --verbose
```

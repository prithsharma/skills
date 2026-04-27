---
name: pull-notion
description: Pull a Notion page to local markdown file for editing. Preserves rich blocks and tracks sync state.
disable-model-invocation: false
---

Pull a Notion page to a local markdown file for editing.

## Arguments

- **Page identifier** (required): Notion page URL or ID
- **Output path** (optional): Local file path. If omitted, creates file in current directory based on page title.

## What to do

1. **Parse arguments:**
   - Extract page ID from URL or use raw ID
   - Determine output path (use provided path or generate from page title)

2. **Fetch page from Notion:**
   - Use `mcp__notion__notion-fetch` with the page ID
   - Get the page content in Notion-flavored Markdown

3. **Process the content:**
   - Extract page title from the fetched content
   - Detect if content has rich blocks (toggles, callouts, tables, columns, synced blocks, meeting notes)
   - Check for patterns: `<details`, `<callout`, `<table`, `<columns`, `<synced_block`, `<meeting-notes`

4. **Check for existing sync:**
   - Load manifest from `~/.notion-sync/manifest.json`
   - Check if this page ID is already synced to a different file path
   - If yes, warn the user and ask if they want to:
     - Update the existing file location
     - Create a new copy at the requested location
     - Cancel

5. **Create frontmatter:**
   ```yaml
   ---
   notion_id: <page_id>
   notion_parent: <parent_page_name_if_available>
   title: <page_title>
   has_rich_blocks: <true|false>
   notion_blocks: .notion-sync/blocks/<page_id>.json
   last_synced: <ISO timestamp>
   ---
   ```

6. **Save rich block data (if applicable):**
   - If `has_rich_blocks` is true, save raw block data to `~/.notion-sync/blocks/<page_id>.json`
   - This preserves the original structure for round-trip syncing

7. **Write local markdown file:**
   - Combine frontmatter + content
   - Write to the output path
   - Ensure parent directories exist

8. **Update manifest:**
   - Read `~/.notion-sync/manifest.json`
   - Add/update entry:
     ```json
     {
       "files": {
         "<output_path>": {
           "notion_id": "<page_id>",
           "last_synced": "<ISO timestamp>",
           "local_hash": "<sha256 of content>",
           "notion_hash": "<sha256 of notion content>",
           "notion_hash_at_sync": "<sha256 of notion content>"
         }
       }
     }
     ```
   - Use Node.js to compute SHA-256 hashes:
     ```bash
     echo -n "content" | openssl dgst -sha256 -binary | xxd -p -c 256
     ```

9. **Confirm:**
   - Show file path created/updated
   - Show whether rich blocks were detected
   - Remind: Edit locally, then use `/push-notion <file>` to push changes back

## Important notes

- If the page has rich Notion blocks (toggles, callouts, etc.), they'll be preserved in Notion-flavored Markdown
- Most rich blocks are editable as-is (XML-like syntax)
- For complex edits to rich blocks, suggest creating subpages
- Always update the manifest to track sync state
- Compute content hashes for conflict detection

## Example usage

```
/pull-notion https://notion.so/workspace/Page-abc123
/pull-notion abc123def456 docs/api-reference.md
```

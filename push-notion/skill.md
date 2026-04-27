---
name: push-notion
description: Push local markdown file to Notion. Creates new page or updates existing. Detects conflicts and performs section-based updates.
disable-model-invocation: false
---

Push a local markdown file to Notion, creating or updating the page.

## Arguments

- **File path** (required): Path to local markdown file to push
- **Force** (optional): `--force` to skip conflict detection and force push

## What to do

1. **Read local file:**
   - Parse frontmatter and content from the markdown file
   - Extract `notion_id`, `notion_parent`, `title`, `has_rich_blocks` from frontmatter
   - Compute hash of current content

2. **Load manifest:**
   - Read `~/.notion-sync/manifest.json`
   - Get the file entry for this path
   - Check sync state

3. **Determine operation:**
   - **If `notion_id` exists in frontmatter:** UPDATE existing page
   - **If no `notion_id`:** CREATE new page

4. **For UPDATE - Detect conflicts:**
   - Skip if `--force` flag is present
   - Fetch current page content from Notion using `mcp__notion__notion-fetch`
   - Compute hash of current Notion content
   - Compare with `notion_hash_at_sync` from manifest
   - **If different:** CONFLICT detected
     - Show diff between local and Notion
     - Ask user what to do:
       - `local` - Use local version (overwrite Notion)
       - `notion` - Use Notion version (discard local changes)
       - `merge` - Show interactive merge (user edits local file to resolve, then re-run)
       - `cancel` - Abort push
     - If user chooses `notion`, update local file and manifest, then exit
     - If user chooses `merge` or `cancel`, exit
     - If user chooses `local`, continue with push

5. **For CREATE - Prepare parent:**
   - Check frontmatter for `notion_parent`
   - If present, search for parent page by title using `mcp__notion__notion-search`
   - Get parent page ID
   - Prepare parent object: `{"type": "page_id", "page_id": "<parent_id>"}`
   - If no parent specified, create as private workspace page (omit parent)

6. **Push to Notion:**

   **For CREATE:**
   - Use `mcp__notion__notion-create-pages` with:
     - `pages`: Array with one page containing `properties` (title) and `content`
     - `parent`: Parent object or omit for private page
   - Get the created page ID from response
   - Add `notion_id` to frontmatter and update local file

   **For UPDATE:**
   - Use `mcp__notion__notion-update-page` with:
     - `page_id`: The notion_id from frontmatter
     - `command`: "replace_content"
     - `new_str`: The full markdown content
   - IMPORTANT: Fetch the page first to check for child pages/databases
   - If child pages exist and they're not in the new content as `<page url="...">` tags, the update will fail
   - Preserve child pages by including them in the content

7. **Update local frontmatter:**
   - Add/update `notion_id` with the page ID
   - Update `last_synced` timestamp
   - Write back to local file

8. **Update manifest:**
   - Compute hash of pushed content
   - Update entry:
     ```json
     {
       "notion_id": "<page_id>",
       "last_synced": "<ISO timestamp>",
       "local_hash": "<sha256 of content>",
       "notion_hash": "<sha256 of notion content after push>",
       "notion_hash_at_sync": "<sha256 of notion content after push>"
     }
     ```
   - All three hashes should now match (no conflicts)

9. **Confirm:**
   - Show Notion page URL (can construct from page ID)
   - Show whether page was created or updated
   - If conflicts were resolved, mention that

## Conflict resolution details

When a conflict is detected:

1. Fetch current Notion content
2. Show diff with 3 sections:
   - Local changes (what you edited)
   - Notion changes (what changed on Notion)
   - Common base (last synced version)
3. Present options clearly
4. For `merge` option, suggest:
   - User manually edits local file to incorporate both changes
   - Re-run `/push-notion` after resolving

## Parent resolution

When `notion_parent` is specified in frontmatter:
- Use `mcp__notion__notion-search` to find parent by title
- If multiple matches, show list and ask user to pick
- If no match, warn and create as private page
- Can also accept page URL in frontmatter for exact match

## Important notes

- **Section-based updates**: For pages with rich blocks, we replace entire content but preserve child pages
- **Notion markdown format**: Content must be in Notion-flavored Markdown (already is if pulled from Notion)
- **Child pages warning**: If updating would delete child pages, the API will fail - we must preserve them
- **Hash tracking**: Three hashes track state:
  - `local_hash`: Current local content
  - `notion_hash`: Current Notion content
  - `notion_hash_at_sync`: Notion content at last sync (for conflict detection)

## Example usage

```
/push-notion docs/api-reference.md
/push-notion docs/api-reference.md --force
```

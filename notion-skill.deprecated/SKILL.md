---
name: notion
description: Work with Notion pages and databases via the official Notion API.
homepage: https://developers.notion.com
metadata:
  clawdbot:
    emoji: 🧠
    requires:
      env:
        - NOTION_API_KEY
    install:
      - id: node
        kind: note
        label: "Requires notion-cli (Node.js) or notion-cli-py (Python). See docs below."
---

# Notion

This skill lets the agent work with **Notion pages and databases** using the official Notion API.

The skill is declarative: it documents **safe, recommended operations** and assumes a local CLI
(`notion-cli`) that actually performs API calls.

## Authentication

- Create a Notion Integration at https://www.notion.so/my-integrations
- Copy the Internal Integration Token.
- Export it as:

```bash
export NOTION_API_KEY=secret_xxx
```

Share the integration with the pages or databases you want to access.
Unshared content is invisible to the API.

## Profiles (personal / work)

You may define multiple profiles (e.g. personal, work) via env or config.

Default profile: personal

Override via:

```bash
export NOTION_PROFILE=work
```

## Pages

Use whatever Notion interface is available (MCP tools, REST API, etc.). Operations below are semantic.

**Read page:** Fetch page by ID → returns content + properties.

**Append content:** Add blocks to a page (prefer markdown format). Prefer appending over rewriting.

**Create page:** Create a new page under a parent page or database with title and optional content.

## Databases

**Inspect schema:** Fetch a database to see its property schema (field names, types, options).

**Query database:** Search/filter within a database by properties. Supports filters (equality, date ranges, etc.) and sorting.

**Create row:** Create a page within a database, setting properties as key-value pairs.

**Update row:** Update an existing page's properties or content.

### Property format notes
- Text/select: `{"Field Name": "value"}`
- Date: use ISO format with datetime flag if needed
- Relation: array of page URLs or IDs
- Check your Notion tool's docs for exact syntax — it varies by provider.

## Schema changes (advanced)

Always inspect the current schema before making changes.

Never modify database schema without explicit user confirmation.

## Safety notes

- Notion API is rate-limited; batch carefully.
- Prefer append and updates over destructive operations.
- IDs are opaque; store them explicitly, do not infer from URLs.

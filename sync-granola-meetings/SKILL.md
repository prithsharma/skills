---
name: sync-granola-meetings
description: Sync Granola meeting notes into a Notion Meeting Notes database. Fetches recent meetings from Granola, deduplicates against already-synced entries, creates Notion rows with metadata + content, and optionally triggers per-meeting processing. Use when asked to sync meetings, pull meetings from Granola, import meeting notes, or check for new meetings. Trigger phrases include "sync meetings", "sync granola", "pull new meetings", "import meetings from granola".
---

# sync-granola-meetings

Fetch recent meetings from Granola → deduplicate → create rows in Notion Meeting Notes DB.

## Granola & Notion Interface

This skill is **tool-agnostic**. Use whatever Granola and Notion interfaces are available:
- MCP tools (mcporter, native MCP, Claude Desktop)
- Direct API calls
- Any other client

The procedure describes **what** to do semantically. Map operations to your environment's tools.

### Granola Operations

| Operation | Description | Key params |
|---|---|---|
| **list_meetings** | Get meetings in a time range | `time_range`: this_week / last_week / last_30_days |
| **get_meetings** | Get full details for specific meetings | `meeting_ids`: array of IDs |

### Notion Operations

| Operation | Description | Key params |
|---|---|---|
| **search** | Search within Meeting Notes DB | `query`, `data_source_url=collection://{{MEETING_NOTES_DS}}` |
| **create_pages** | Create meeting row + content | `pages` (properties + content), `parent` |

## Config

| Parameter | Description | Source |
|---|---|---|
| `MEETING_NOTES_DS` | Work Notion Meeting Notes datasource ID | MEMORY.md or TOOLS.md |
| `MEETING_NOTES_DB_ID` | Work Notion Meeting Notes database ID (for create_pages parent) | MEMORY.md or TOOLS.md |
| `LOGS_CHANNEL` | Slack channel for run reports | MEMORY.md or TOOLS.md |
| `STATE_FILE` | Path to sync state JSON | Default: `memory/granola-sync-state.json` |

## Input

- `hours` — lookback window in hours (default: 4)
- `days` — lookback in days (converted to hours; overridden by `hours`)
- `dry_run` — fetch + parse but skip Notion writes (default: false)
- `force_ids` — specific meeting IDs to re-sync regardless of state
- `no_process` — sync only, skip triggering per-meeting processing (default: false)

## Procedure

### 1. Refresh tokens
Ensure Granola and Notion auth tokens are current. How this happens depends on your environment (token refresh script, mcporter auto-refresh, manual auth, etc.).

### 2. Load state
Read `{{STATE_FILE}}` to get:
- `synced_ids[]` — meetings already in Notion (skip these)
- `last_run_failed` — if true, extend lookback by `last_run_window_hours`
- `last_run_window_hours` — how many hours the last run covered

**Failure catchup**: if last run failed, effective_hours = requested_hours + last_run_window_hours.

### 3. Fetch meeting list
**list_meetings** from Granola with appropriate time_range:
- ≤7 days → `this_week`
- ≤14 days → `last_week`
- else → `last_30_days`

Filter results to the effective lookback window. Skip already-synced IDs (unless in `force_ids`).

### 4. Fetch meeting details
For each batch of meetings (up to 5 at a time), **get_meetings** to retrieve:
- Summary text
- Private notes
- Known participants (attendees)

### 5. Parse attendees
Extract attendee names from participant data. Clean up formatting (remove org names, "note creator" tags, etc.).

### 6. Create Notion rows
For each meeting, **create page** in Meeting Notes DB:
```
properties:
  Title: <meeting title>
  Date: <meeting datetime, IST>
  Attendees: <comma-separated names>
  Granola ID: <meeting ID>
  Granola URL: https://notes.granola.ai/d/<meeting ID>
  Synced At: <now, IST>
  Processing Status: synced
content:
  <summary text>
  <private notes in toggle section>
```

### 7. Trigger processing (optional)
If `no_process` is false, trigger the `process-meeting` skill for each newly synced meeting:
- Search Meeting Notes DB for the just-created row to get its page ID
- Spawn per-meeting processing (subagent or inline, depending on environment)

### 8. Save state
Update `{{STATE_FILE}}`:
```json
{
  "synced_ids": ["id1", "id2", ...],
  "last_sync": "<ISO timestamp>",
  "last_run_failed": false,
  "last_run_window_hours": <effective_hours>
}
```

### 9. Report
Post run summary to logs channel:
- Meetings synced count
- Meetings processed count (if applicable)
- Failures (if any)
- Source tag: `[source: sync-granola-meetings skill]`

## Granola Date Handling

Granola returns date strings without timezone metadata (e.g. "Mar 31, 2026 4:30 PM"). Parse as local time (IST in most cases). Meetings organized from other timezones may have incorrect times — this requires a calendar integration to fix.

When writing to Notion, use IST offset format: `2026-03-31T16:30:00+05:30`

## Bundled Script (Reference Implementation)

`scripts/granola-notion-sync.mjs` is a complete Node.js implementation for mcporter + curl environments. It handles all the above steps including token refresh, batching, state management, failure catchup, and Slack reporting.

Usage:
```bash
node scripts/granola-notion-sync.mjs                    # default: last 4h
node scripts/granola-notion-sync.mjs --hours 8          # custom lookback
node scripts/granola-notion-sync.mjs --days 2           # days lookback
node scripts/granola-notion-sync.mjs --dry-run          # preview only
node scripts/granola-notion-sync.mjs --force-ids a,b    # force re-sync
node scripts/granola-notion-sync.mjs --no-process       # sync only, skip processing
```

On other environments, the agent reads this SKILL.md and executes the flow using its own Granola/Notion tools — no need to run the script.

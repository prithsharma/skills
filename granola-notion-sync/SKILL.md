# granola-notion-sync

Syncs Granola meeting notes → Work Notion Meeting Notes DB.

## Script

```
scripts/granola-notion-sync.mjs
```

(Path relative to workspace root: `/Users/claw/.openclaw/workspace`)

## Usage

```bash
# Default: last 4 hours (normal cron run)
node scripts/granola-notion-sync.mjs

# Custom lookback
node scripts/granola-notion-sync.mjs --hours 8
node scripts/granola-notion-sync.mjs --days 2

# Preview without writing to Notion
node scripts/granola-notion-sync.mjs --hours 4 --dry-run

# Force re-sync specific meetings (even if already synced)
node scripts/granola-notion-sync.mjs --force-ids <id1>,<id2>

# Combine
node scripts/granola-notion-sync.mjs --days 1 --dry-run
```

## Options

| Option | Default | Description |
|---|---|---|
| `--hours <n>` | 4 | Look back N hours |
| `--days <n>` | — | Look back N days (converted to hours; overridden by --hours) |
| `--dry-run` | off | Fetch + parse but skip Notion writes |
| `--force-ids <ids>` | — | Comma-separated IDs to re-sync regardless of state |

## Failure catchup

If the last run failed (`last_run_failed=true` in state), the next run automatically extends its lookback by `last_run_window_hours` to cover the gap. No manual intervention needed.

## State file

`memory/granola-sync-state.json` — tracks synced IDs and run metadata. Safe to inspect; do not manually edit `synced_ids` unless you want to force a re-sync.

## Dependencies

- `mcporter` — MCP client (installed at `node_modules/.bin/mcporter`)
- MCP servers: `granola` + `mcp-notion-com-mcp` (must be configured in mcporter)
- Work Notion DB: `8a9dd66e-abb7-45a2-937e-d9ee0fe49bc3`

## Cron

Runs every 2 hours via OpenClaw cron (`granola-notion-sync`, id: `f0b314be-ebf5-4bea-ba58-3d614c24eae4`).

To trigger manually via OpenClaw:
```bash
openclaw cron run f0b314be-ebf5-4bea-ba58-3d614c24eae4
```

Or run the script directly as above for full control over params.

## Sharing with Claude Code

This skill and its script are self-contained. To use in another agent:
1. Copy `scripts/granola-notion-sync.mjs` to the target workspace's `scripts/` folder
2. Ensure `mcporter` is available and `granola` + `mcp-notion-com-mcp` MCP servers are configured
3. Run as above — state file will be created automatically on first run

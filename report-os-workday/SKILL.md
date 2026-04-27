---
name: report-os-workday
description: Generate a daily OS workday report summarizing what was built, decisions made, and current roadmap state. Use when asked to generate an EOD report, daily recap, workday summary, or OS report. Trigger phrases include "report os workday", "eod report", "daily recap", "what did we do today", "summarize the day".
---

# report-os-workday

Generate a daily report of OS work from memory files and Slack channels.

## Slack Interface

This skill is **tool-agnostic**. Use whatever Slack interface is available (native tool, API, bot client). If no Slack tool exists, output the report for manual delivery.

## Config

| Parameter | Description | Source |
|---|---|---|
| `LOGS_CHANNEL` | Slack channel to post the report | MEMORY.md or TOOLS.md |
| `SLACK_SCAN_CHANNELS` | Channels to scan for unreported work | Comma-separated IDs |
| `MEMORY_DIR` | Path to daily memory files | Default: `memory/` in workspace |

## Input

- `DATE` — the date to report on (default: today, ISO format YYYY-MM-DD)

## Procedure

### 1. Gather sources

Read `memory/{{DATE}}.md` as the primary source of truth. This file should contain entries for everything that happened during the day.

### 2. Slack failsafe scan

Scan each channel listed in `SLACK_SCAN_CHANNELS` for today's activity that might not be in the memory file. Each channel should be mapped to a purpose in TOOLS.md or the agent's config (e.g. one for skill/integration work, one for OS design decisions, one for meeting notes).

If Slack scan finds items not in the memory file:
- Append them to `memory/{{DATE}}.md` first
- Then include in the report

### 3. Generate report

Format:

```
🗓️ EOD — {{DATE_DISPLAY}}

🔨 Built / Shipped
- Item 1
- Item 2

💬 Decisions
- Decision 1
- Decision 2

🏗️ OS Roadmap — Current State
- Status of major workstreams

🧵 Open Threads
- <https://your-workspace.slack.com/archives/CHANNEL/pTHREADTS|Thread title> — one-line status
```

Rules:
- **Only include items from the target date** — do not bleed in previous/next day's work
- No "Next" section — removed for brevity
- Source tag: `[source: report-os-workday skill]`
- **Open Threads section:** scan `discussions/trails/` for trail files where `Status` is NOT `concluded` / `archived`. For each, include a Slack deep link and a one-line summary of what's still open. Format the link as `https://your-workspace.slack.com/archives/<channelId>/p<threadTs-without-dot>`. If no open trails, omit the section.

### 4. Deliver

Post to the configured logs channel. If the agent lacks a Slack tool, output the report with the target channel noted for manual delivery.

## On-Demand Usage

Ask the agent: "report os workday" or "eod report" or "recap today"

For a specific date: "recap yesterday" or "report os workday for 2026-04-01"

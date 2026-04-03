---
name: process-meeting
description: Process a single Granola meeting into structured Notion data — extract action items, decisions, and summary, write tasks and decisions to project pages, post summary to Slack. Use when asked to process a meeting, digest meeting notes, or handle unprocessed meetings. Trigger phrases include "process this meeting", "digest meeting", "process unprocessed meetings".
---

# process-meeting

Process one Granola meeting → Work Notion tasks + decisions on project pages + Slack summary.

## Notion & Slack Interface

This skill is **tool-agnostic**. Use whatever Notion and Slack interfaces are available:
- MCP tools (mcporter, native MCP, Claude Desktop, etc.)
- Direct REST API calls
- Native agent tools

The processing steps describe **what** to do (search, create, update), not how to call a specific tool. Map operations to your environment. See [references/processing-steps.md](references/processing-steps.md) for the operations reference.

## Config

Resolve these before running. Check TOOLS.md, MEMORY.md, Keychain, or ask the user.

| Parameter | Description | Source |
|---|---|---|
| `TASKS_DS` | Work Notion Tasks datasource ID | MEMORY.md or TOOLS.md |
| `PROJECTS_DS` | Work Notion Projects datasource ID | MEMORY.md or TOOLS.md |
| `MEETING_NOTES_DS` | Work Notion Meeting Notes datasource ID | MEMORY.md or TOOLS.md |
| `UNSORTED_PAGE_ID` | Notion page ID for unmatched decisions | MEMORY.md or TOOLS.md |
| `LOGS_CHANNEL` | Personal Slack channel for summaries | MEMORY.md or TOOLS.md |
| `WORK_SLACK_TOKEN` | Work Slack bot token (for Slack ID resolution) | Keychain or env |

## Input

The skill expects these values for the meeting being processed:

- `MEETING_ID` — Granola meeting ID
- `MEETING_TITLE` — meeting title
- `MEETING_DATE` — ISO date (e.g. 2026-03-31)
- `MEETING_DATE_DISPLAY` — human-readable (e.g. Mar 31, 2026 12:00 PM)
- `ATTENDED` — "Yes", "No", or blank (unknown)
- `ATTENDEES` — comma-separated names
- `SUMMARY` — full meeting summary text
- `ACTION_ITEMS` — action items text
- `MY_TASKS` — action items assigned to the user
- `OTHER_TASKS` — action items on others that involve the user

## Workflow

Follow the step-by-step procedure in [references/processing-steps.md](references/processing-steps.md).

High-level:
1. **Dedup check** — search Meeting Notes DB for existing row
2. **Create/update Meeting Notes row** — set Processing Status → `processing`
3. **Create Prithvi's tasks** — Owner=`me`, Type=`Task`
4. **Create Waiting On tasks** — Owner=`openclaw`, Type=`Waiting On`, with follow-up scheduling
5. **Extract decisions → write to project pages** — match to projects, fallback to Unsorted
6. **Detect unknown projects** → write to `memory/pending-projects.json`
7. **Post summary to Slack** (#logs channel)
8. **Mark Processing Status → `done`**
9. **Append to daily memory file**

## Rules

- NEVER create duplicate meeting rows — always search first
- NEVER write decisions as standalone KB entries — decisions go in project pages only
- Every decision MUST land on a project/area page or the Unsorted page
- Granola URL format: `https://notes.granola.ai/d/<id>` (NOT `app.granola.ai`)
- Only create tasks that directly involve the user (their action items + things they're waiting on)
- Skip action items purely on other people that don't affect the user
- If a step fails, continue with the rest and note the failure in the output

## Task Owner Assignment

| Type | Owner |
|---|---|
| Waiting On | `openclaw` (always — tracking responsibility) |
| Open Loop | `openclaw` (always — tracking responsibility) |
| Task — explicitly user's | `me` |
| Task — AI can execute end-to-end | `openclaw` |
| Task — everything else | **SKIP** |

## Orchestration

This skill processes ONE meeting. To process all unprocessed meetings:
1. Query Meeting Notes DB for `Processing Status = synced`
2. Spawn one subagent per meeting, each running this skill
3. Each runs in parallel, isolated — one failure doesn't affect others

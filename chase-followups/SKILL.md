---
name: chase-followups
description: Check for overdue "Waiting On" tasks in Notion, draft follow-up DMs, and send them after approval. Use when asked to chase follow-ups, send reminders, nudge people, or check overdue tasks. Trigger phrases include "chase follow-ups", "send follow-ups", "check overdue tasks", "nudge", "any follow-ups due".
---

# chase-followups

Query Notion for overdue Waiting On tasks → draft follow-up DMs → post for approval → send after approval.

## Notion & Slack Interface

This skill is **tool-agnostic**. The SKILL.md describes the logic; the bundled scripts in `scripts/` are a **reference implementation** for mcporter + curl environments (e.g. OpenClaw cron). On other setups (Claude Code, etc.), the agent reads this SKILL.md and executes the flow using its own native Notion/Slack tools — no need to run the scripts.

## Config

| Parameter | Description | Source |
|---|---|---|
| `TASKS_DS` | Work Notion Tasks datasource ID | MEMORY.md or TOOLS.md |
| `LOGS_CHANNEL` | Personal Slack channel for approval drafts | MEMORY.md or TOOLS.md |
| `WORK_SLACK_TOKEN` | Work Slack bot token (for sending DMs) | Keychain or env |
| `ESCALATION_THRESHOLD` | Follow-ups before escalation | Default: `3` |

## Two-Phase Flow

### Phase 1: Draft (cron or on-demand)

Run `scripts/followup-cron.mjs` — it handles:
1. Query Notion: `Type = Waiting On` + `Follow-up Status = scheduled` + `Follow-up Due ≤ now`
2. Parse each task's page body for assignee, Slack ID, meeting, action item, category
3. Craft DM message per task (delivery = direct reminder, discussion = soft check-in)
4. Resolve Slack IDs (use stored ID, fallback to users.list lookup)
5. Write drafts to `memory/followup-drafts.json`
6. Post batch to logs channel for approval

### Phase 2: Send (after approval)

Run `scripts/followup-send.mjs` with flags:
```bash
# Send all approved
node scripts/followup-send.mjs

# Skip specific people
node scripts/followup-send.mjs --skip="Name1,Name2"

# Mark specific tasks resolved without sending
node scripts/followup-send.mjs --resolve="Name3"
```

This handles:
1. Read `memory/followup-drafts.json`
2. Open DM channels on work Slack
3. Send follow-up messages
4. Update Notion: bump follow-up count, set next Follow-up Due, update status
5. Write results to `memory/followup-send-log.jsonl`

## Approval Commands

After drafts are posted, the user can reply:
- `send` → send all
- `send, skip [Name]` → send all except Name
- `resolve [Name]` → mark done without sending
- `correct [Name]=U0SLACKID` → update draft with correct Slack ID, re-post for approval
- `escalate [Name]` → mark as escalated, notify user
- `drop [Name]` → skip the escalation

## Task Page Body Format

Each Waiting On task page body follows this template:
```
Assignee: [Full Name] | [Slack ID]
Meeting: [Meeting Name] | [Granola URL]
Action item: [verbatim from meeting]
Category: delivery | discussion
Follow-up count: 0
Last follow-up: —
Context: [optional]
```

## Follow-up Categories

| Category | Cadence | Tone |
|---|---|---|
| `delivery` | 12h initial, 24h subsequent | Direct reminder — clear deliverable expected |
| `discussion` | 36h initial, 48h subsequent | Soft check-in — open-ended topic |

## Escalation

After `ESCALATION_THRESHOLD` follow-ups with no resolution:
- `Follow-up Status` → `escalated`
- DM the user with escalation details
- No more automatic follow-ups until manually resolved

## On-Demand Usage

Run Phase 1 manually anytime:
```bash
node scripts/followup-cron.mjs
```
Review the drafts in the logs channel, then approve as usual.

## State Files

- `memory/followup-drafts.json` — current batch of pending drafts
- `memory/followup-send-log.jsonl` — append-only log of all sent follow-ups
- `memory/followup-cron.log` — runtime log

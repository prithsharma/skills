# Processing Steps — Detailed Procedure

## Notion Interface

This skill is **tool-agnostic**. Use whatever Notion interface is available in your environment:
- MCP tools (via mcporter, native MCP, or Claude Desktop integration)
- Direct API calls
- Any other Notion client

The operations below describe **what** to do semantically. Map to your environment's tools.

### Operations Reference

| Operation | Description | Key params |
|---|---|---|
| **search** | Search within a datasource | `query`, `data_source_url=collection://{{DS_ID}}` |
| **fetch** | Get full page content | `id` (page ID or URL) |
| **create_pages** | Create one or more pages | `pages` (array of property objects), `parent` (`{data_source_id: "..."}`) |
| **update_page** | Update properties or content | `page_id`, `command` (update_properties / update_content / replace_content), `properties` or `content_updates` |

### Property Formats

- Text/select: `{"Field Name": "value"}`
- Date: `{"date:Field Name:start": "ISO-date", "date:Field Name:is_datetime": 0|1}`
- Relation: `{"Field Name": "[\"https://www.notion.so/<page_id>\"]"}`

---

## Step 1 — Dedup check

**Search** Meeting Notes DB for existing row matching this meeting title.
- `query`: `{{MEETING_TITLE}}`
- `data_source_url`: `collection://{{MEETING_NOTES_DS}}`

If found → get page_id, go to Step 2b. Not found → Step 2a.

## Step 2a — Create Meeting Notes row

**Create page** in Meeting Notes DB:
```
parent: {data_source_id: {{MEETING_NOTES_DS}}}
properties:
  Title: {{MEETING_TITLE}}
  Date: {{MEETING_DATE}} (date, not datetime)
  Attended: {{ATTENDED}}
  Attendees: {{ATTENDEES}}
  Granola ID: {{MEETING_ID}}
  Granola URL: https://notes.granola.ai/d/{{MEETING_ID}}
  Processing Status: processing
  Action Items: {{ACTION_ITEMS}}
  Synced At: {{MEETING_DATE}} (date, not datetime)
```
Note the returned page URL/ID for later steps.

## Step 2b — Update existing row

**Update page** properties on existing meeting row:
```
page_id: <existing_id>
command: update_properties
properties:
  Processing Status: processing
  Action Items: {{ACTION_ITEMS}}
  Attended: {{ATTENDED}}
  Attendees: {{ATTENDEES}}
  Granola ID: {{MEETING_ID}}
  Granola URL: https://notes.granola.ai/d/{{MEETING_ID}}
```

## Step 3 — Create tasks for the user

For each action item in `{{MY_TASKS}}`:
1. **Search** Tasks DB to avoid duplicates
2. **Create page** in Tasks DB:
```
parent: {data_source_id: {{TASKS_DS}}}
properties:
  Title: <task title>
  Status: Todo
  Owner: me
  Type: Task
  Notes: From {{MEETING_TITLE}} {{MEETING_DATE}}
```

## Step 3b — Create Waiting On tasks

For items in `{{OTHER_TASKS}}` where someone owes the user a deliverable/response.

### Determine category
- `delivery` (12h cadence): ticket, doc, update, PR, review, share, send — clear output
- `discussion` (36h cadence): proposal, process, discussion, align, investigate — open-ended

### Compute Follow-up Due
From meeting end time (NOT task creation time):
- `delivery`: meeting_end + 12 hours
- `discussion`: meeting_end + 36 hours

### Resolve assignee Slack ID
Use whatever Slack interface is available (API, native tool, bot client):
- List workspace users, match by `real_name`, `display_name`, or first-name prefix (case-insensitive)
- Resolved → use as Slack ID in task body
- Not resolved → use `unknown`, post warning to logs channel

### Create the task
**Create page** in Tasks DB:
```
parent: {data_source_id: {{TASKS_DS}}}
properties:
  Title: <action item title>
  Status: Todo
  Owner: openclaw
  Type: Waiting On
  Follow-up Status: scheduled
  Follow-up Due: <ISO datetime> (datetime, not date)
```

### Write task page body
**Update page** content:
```
Assignee: [Full Name] | [Slack ID or "unknown"]
Meeting: {{MEETING_TITLE}} | https://notes.granola.ai/d/{{MEETING_ID}}
Action item: [verbatim from meeting]
Category: delivery | discussion
Follow-up count: 0
Last follow-up: —
Context: [optional extra context]
```

## Step 4 — Decisions → project pages

### 4a — Extract decisions
From summary: agreements, direction changes, ownership assignments, process changes. Skip trivial status updates.

### 4b — Match to projects
**Search** Projects DB to get current list:
- `data_source_url`: `collection://{{PROJECTS_DS}}`
- Match each decision to a project by topic/team/initiative
- One decision → one project

### 4c — Write to project pages
**Fetch** the project page, then **update content** to append to Decisions Log section:
```
**{{MEETING_DATE}} | [{{MEETING_TITLE}}](https://www.notion.so/<meeting_notion_id>)**
- Decision 1
- Decision 2
```

If no Decisions Log section exists, create one:
```
---
## Decisions Log

**{{MEETING_DATE}} | [{{MEETING_TITLE}}](https://www.notion.so/<meeting_notion_id>)**
- Decision 1
```

### 4d — Unsorted fallback
Unmatched decisions → Unsorted page (`{{UNSORTED_PAGE_ID}}`), same format with extra context:
```
**{{MEETING_DATE}} | [{{MEETING_TITLE}}](https://www.notion.so/<meeting_notion_id>)**
- Decision text
  _Context: [what this relates to, who was involved]_
```

### 4e — Link meeting to project
**Update page** properties on meeting row:
```
Project: ["https://www.notion.so/<project_page_id>"]
```

## Step 5 — Project detection

Scan summary for named initiatives with scope + expected outcome. Compare against projects fetched in 4b.

For unknown projects, append to `memory/pending-projects.json` (read first if exists):
```json
{
  "name": "Project Name",
  "rationale": "why this looks like a project",
  "source_meeting_id": "{{MEETING_ID}}",
  "source_meeting_title": "{{MEETING_TITLE}}",
  "source_meeting_date": "{{MEETING_DATE}}",
  "meeting_notion_id": "<page_id>",
  "related_task_ids": [],
  "status": "pending"
}
```

## Step 6 — Post to Slack

Post combined message to logs channel. Use whatever Slack interface is available.

Include:
1. 📋 Meeting summary (2-3 sentences)
2. Tasks created count
3. Decisions logged count + which project pages
4. ⚠️ Unsorted decisions if any
5. 🆕 New project candidates if any
6. User's action items (bulleted)
7. "Want me to share this summary with anyone on work Slack?"

Source tag: `[source: process-meeting skill]`

## Step 7 — Mark done

**Update page** properties on meeting row:
```
Processing Status: done
```

## Step 8 — Write to memory

Append to `memory/meeting-processing-{{MEETING_DATE}}.md`:
```markdown
## {{MEETING_TITLE}} — {{MEETING_DATE_DISPLAY}}
- Meeting Notes row: <notion_url>
- Processing Status: done
- Tasks created: <list with IDs>
- Unknown projects flagged: <list or "none">
- Summary posted: yes/no
```

## Error handling

If any step fails, continue with remaining steps. Note failures in Step 8 output. Only set Processing Status to `failed` if Step 2 (create/update row) fails.

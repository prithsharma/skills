---
name: archive-sessions
description: Archive sessions from .claude/ history to keep /resume clean. Supports quick-archive current session or bulk-archive multiple old sessions. Moves conversation files to ~/os/archive/YYYY/MM/ and updates the index.
disable-model-invocation: true
---

Clean up Claude Code conversation history by archiving old sessions.

## What to do

1. **Ask what to archive:**
   - Use AskUserQuestion:
     - "Current session" - Archive just this session
     - "Select from all sessions" - Bulk archive multiple
     - "Cancel"

2. **If "Current session":**
   - Use ONE script to:
     - Get current session ID
     - Find session in sessions-index.json
     - Extract year/month from date
     - Create ~/os/archive/{YYYY}/{MM}/
     - Move .jsonl file
     - Update sessions-index.json
   - Confirm: "Archived to ~/os/archive/{YYYY}/{MM}/"

3. **If "Select from all sessions":**
   - Use ONE script to:
     - Find sessions-index.json for current project
     - Parse all sessions (date, summary, message count, path, ID)
     - Output structured data
   - Present with AskUserQuestion (multiSelect: true)
   - Sort by date (oldest first)
   - Exclude current active session
   - Confirm: "Archive {count} sessions?"
   - Use ONE script to:
     - For each session: extract year/month, create dirs, move files
     - Update sessions-index.json
   - Report results with file paths

**Safety:**
- Never archive current active session
- Always confirm before archiving
- Sessions are moved, not deleted

**Efficiency:** Use scripts to consolidate file operations. Minimize separate permission prompts.

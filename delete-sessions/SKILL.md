---
name: delete-sessions
description: Permanently delete conversations from Claude Code history.
disable-model-invocation: true
---

Permanently delete conversations from Claude Code history.

## What to do

1. **Fast initial prompt (low latency):**
   - Immediately ask (before loading sessions):
     - "Delete current session" - 🔥 Ends immediately
     - "Delete other sessions" - Load and show list
     - "Cancel"

2. **If "Delete current session":**
   - Skip to step 5 (confirmation)
   - No need to read sessions yet

3. **If "Delete other sessions":**
   - Use ONE script to:
     - Source validation library: `. ~/.claude/skills/common/validation.sh`
     - Get current project path dynamically (never hardcode)
     - Find and validate sessions-index.json
     - Parse all sessions (date, summary, count, path, ID)
     - Validate each session_id format
     - Sort by date (latest first)
     - Output structured format
   - Show formatted list
   - Ask deletion method:
     - "Delete by session numbers" (e.g., '1,3,5')
     - "Delete all sessions before date" (YYYY-MM-DD)
     - "Delete all indexed sessions" (⚠️ nuclear)
     - "Cancel"
   - Based on choice: parse input, filter sessions

4. **Confirm before deletion:**
   - **If current session:**
     - "🔥 WARNING: Permanently delete THIS SESSION. Conversation will end immediately."
     - "⚠️ This action cannot be undone. Session will be deleted when you exit."
     - Options: "Delete and exit" / "Cancel"
   - **If other sessions:**
     - "⚠️ Permanently delete {count} sessions? Cannot be undone."
     - Show exact file paths that will be deleted
     - Options: "Delete permanently" / "Cancel"

5. **Delete:**
   - **For all deletions, use ONE script that:**
     - Sources validation: `. ~/.claude/skills/common/validation.sh`
     - Validates all session IDs (UUID format check)
     - Verifies files exist before deletion
     - Validates files are in correct project directory
     - Creates backup of sessions-index.json before modification
     - Performs atomic index update (use temp file + move)
     - Audit logs each deletion
     - Deletes session .jsonl files
     - On failure: restores from backup

   - **If current session:**
     - Delete current session .jsonl file immediately
     - Update sessions-index.json immediately
     - Audit log the deletion
     - Exit conversation after deletion completes

   - **If other sessions:**
     - Process each session sequentially
     - Audit log each deletion
     - Report: List deleted sessions with dates and IDs

6. **Error handling:**
   - If session ID validation fails: abort, show error
   - If file not found: skip, log warning
   - If index update fails: restore backup, abort
   - If path traversal detected: abort immediately

**Safety:**
- All session IDs validated before any deletion
- Files verified to be in correct project directory
- All deletions logged to ~/.claude/logs/deletion-audit.log
- Backup of index created before modifications
- Atomic operations prevent partial failures
- Current session deletion is immediate, no deferred mechanism
- Use /archive-sessions if you want to keep sessions

**Efficiency:** Consolidate session loading and file operations into single scripts with proper validation.

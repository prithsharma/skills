---
name: stash-session
description: Stash the current session for later resumption. Creates a metadata file in ~/os/stashed/ with session ID and context for easy browsing and resuming later.
disable-model-invocation: false
---

Stash this session for later resumption.

## What to do

1. **Analyze conversation and extract:**
   - Topic: 2-4 word lowercase-with-dashes summary (e.g., "fix-auth-bug")
   - Context: 1-2 sentence description of the work
   - Key files: 3-5 most important files/paths discussed

2. **Create/update stash file at `~/os/stashed/{topic}-{YYYYMMDD}.md`:**
   - If session already stashed (grep for session_id in ~/os/stashed/), update that file
   - Otherwise create new file (append -2, -3 etc if collision)
   - Use ONE bash script to gather all metadata and create/update the file
   - Metadata format:
     ```
     session_id: <from session metadata>
     session_start_date: <from first entry in ~/.claude/history.jsonl>
     stash_date: <today>
     topic: <generated>
     context: <generated>
     working_directory: <current pwd>
     key_files: <generated>
     ```

3. **Output the rename command:**
   - Convert topic to Title Case: "fix-auth-bug" → "Fix Auth Bug"
   - Show the exact command to run as the LAST line:
   ```
   /rename {Title Case Topic} 📌
   ```
   - This allows the user to quickly autocomplete and run it

4. **Confirm:**
   - Show file path (created/updated)
   - Remind: `/browse-stashed-sessions` to see all, `/resume <id>` to resume

**Efficiency:** Use ONE bash script for all metadata gathering. Output the `/rename` command at the end for easy execution.

---
name: unstash-session
description: Unstash the current session by removing the stash indicator and deleting the stash file.
user-invocable: true
disable-model-invocation: true
---

Unstash the current session - removes the 📌 indicator and deletes the stash file.

## What to do

1. **Find and delete the stash file:**
   - Use ONE bash script to:
     - Source validation library: `. ~/.claude/skills/common/validation.sh`
     - Get current session ID from session metadata
     - Validate session_id format (UUID check)
     - Search for stash file: `grep -l "session_id: <uuid>" ~/os/stashed/*.md 2>/dev/null`
     - Handle multiple matches (error if > 1 found)
     - Validate stash file path is in ~/os/stashed/ (prevent traversal)
     - Audit log the deletion
     - Delete the stash file
     - Handle errors: directory doesn't exist, no files found, permission denied

2. **Output the rename command:**
   - Get the current session title from context or metadata
   - If it ends with " 📌", remove it
   - Show the exact command to run as the LAST line:
   ```
   /rename {Title Without Pin}
   ```
   - This allows the user to quickly autocomplete and run it

3. **Confirm:**
   - Show which stash file was deleted (full path)
   - If no stash file found: "No stash file found for this session"
   - If multiple found: "ERROR: Multiple stash files found, manual cleanup required"
   - All deletions logged to ~/.claude/logs/deletion-audit.log

**Safety:**
- Session ID validated before any operations
- Stash file path verified to be in ~/os/stashed/
- Multiple match scenario triggers error (no silent deletions)
- All deletions logged to ~/.claude/logs/deletion-audit.log
- Errors reported clearly to user

**Efficiency:** Use ONE bash script with proper validation and error handling.

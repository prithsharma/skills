---
name: browse-stashed-sessions
description: Browse stashed sessions and select one to resume or unstash. Scans ~/os/stashed/ directory and presents an interactive list.
disable-model-invocation: true
---

Browse stashed sessions and choose to resume or unstash.

## What to do

1. **Scan all stash files with ONE script:**
   - Parse all `.md` files in `~/os/stashed/`
   - Extract: session_id, session_start_date, stash_date, topic, context, working_directory, key_files
   - Output as JSON or structured format for easy parsing
   - Handle backward compatibility: "date" field = stash_date if no separate fields

2. **Present selection interface:**
   - Use AskUserQuestion with the parsed sessions
   - Sort by stash_date (most recent first)
   - Label format:
     - With session_start_date: "{topic} (M/D→M/D)"
     - Without: "{topic} (M/D)"
   - Description: "{context}"

3. **Ask what to do with selected session:**
   - After user selects, ask action:
     - "Resume" - Show resume instructions
     - "Unstash (remove from list)" - Delete stash file
     - "Cancel" - Do nothing

4. **If Resume:**
   - Show session details (started, stashed, working_directory, context)
   - If current directory ≠ stashed directory: cd to it
   - Output on last line:
   ```
   /resume {session-id}
   ```

5. **If Unstash:**
   - Delete stash file
   - Confirm: "Unstashed: {topic}"

**Efficiency:** ONE script to scan and parse all stash files. Present all data at once.

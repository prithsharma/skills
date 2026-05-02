---
name: ln-nested-skills
description: Create symlinks for nested skills in any subdirectory under ~/.claude/skills/ to make them discoverable
---

# Symlink Nested Skills

Creates symlinks for all skills nested in subdirectories under `~/.claude/skills/` to the top level so they are discovered by Claude Code.

## Usage

```
/ln-nested-skills
```

Automatically creates symlinks for any nested skills (identified by SKILL.md files) that don't already have top-level symlinks.

## What it does

1. Scans all subdirectories under `~/.claude/skills/`
2. Finds any nested directories containing a `SKILL.md` file
3. Creates top-level symlinks for skills that don't already exist
4. **Updates `.git/info/exclude`** (local, never committed) to hide symlinks whose parent directories are already gitignored
5. Reports what was created or skipped

The script only hides symlinks to skills in directories you've explicitly gitignored (like `private-skills/`). Public third-party skill repos won't be hidden.

## Why this exists

Claude Code only discovers skills at the top level of `~/.claude/skills/`. Skills nested in subdirectories (like `private-skills/`, `work-skills/`, etc.) are not automatically discovered. This skill automates creating the necessary symlinks.

## Example

```
~/.claude/skills/
├── private-skills/
│   ├── devrev-dls/          ← nested skill
│   └── internal-newsletter/ ← nested skill
└── work-skills/
    └── company-tool/        ← nested skill
```

After running `/ln-nested-skills`:

```
~/.claude/skills/
├── devrev-dls → private-skills/devrev-dls/
├── internal-newsletter → private-skills/internal-newsletter/
├── company-tool → work-skills/company-tool/
├── private-skills/
└── work-skills/
```

Run this after adding new skills to any subdirectory.

## Pre-commit Hook

This skill also installs a git pre-commit hook that:
- **Blocks** commits if you try to stage symlinks to nested skills
- **Warns** if there are nested skills without symlinks

The hook reminds you to run `/ln-nested-skills` to fix the issue.

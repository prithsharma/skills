# skills

Agent skills for OpenClaw (and other compatible agents).

## Skills

| Skill | Description |
|-------|-------------|
| `granola-notion-sync` | Syncs Granola meeting notes to Notion |
| `mcporter-skill` | MCP server proxy via mcporter |
| `notion-skill` | Notion API bridge for reading/writing pages and databases |

## Usage

Install via clawhub or copy the skill directory into your agent's skills folder.

Each skill contains a `SKILL.md` that describes its interface and usage.

## Private Skills Setup

This repo supports mixing public and private skills using nested git repositories:

1. **Add private repos to `.gitignore`**:
   ```gitignore
   private-skills/
   company-skills/
   ```

2. **Clone private repos** into the skills directory:
   ```bash
   cd ~/.claude/skills
   git clone git@github.com:you/private-skills.git
   ```

3. **Run `/ln-nested-skills`** to:
   - Create symlinks for skill discovery
   - Auto-update `.git/info/exclude` (local, never committed)

**Result**: Private skill names never appear in the public repo. The `.git/info/exclude` file keeps symlinks out of commits locally.

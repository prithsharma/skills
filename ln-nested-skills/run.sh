#!/bin/bash
set -euo pipefail

SKILLS_DIR="$HOME/.claude/skills"
GIT_EXCLUDE="$SKILLS_DIR/.git/info/exclude"

echo "🔍 Scanning for nested skills in $SKILLS_DIR..."
echo

created=0
skipped=0
symlinks_to_ignore=()

# Find all SKILL.md files nested in subdirectories (not at top level)
# Exclude common directories that shouldn't contain skills
while IFS= read -r -d '' skill_md; do
  # Get the skill directory (parent of SKILL.md)
  skill_dir=$(dirname "$skill_md")

  # Get the relative path from skills directory
  rel_path="${skill_dir#$SKILLS_DIR/}"

  # Skip if this is already at top level (no slash in relative path)
  if [[ "$rel_path" != */* ]]; then
    continue
  fi

  # Get the skill name (basename of skill directory)
  skill_name=$(basename "$skill_dir")

  # Get parent directory (e.g., private-skills/)
  parent_dir=$(echo "$rel_path" | cut -d'/' -f1)

  # Check if top-level symlink already exists
  top_level_path="$SKILLS_DIR/$skill_name"

  if [ -e "$top_level_path" ]; then
    if [ -L "$top_level_path" ]; then
      # Already a symlink - check if it points to the right place
      current_target=$(readlink "$top_level_path")
      if [ "$current_target" = "$skill_dir" ] || [ "$current_target" = "$rel_path" ]; then
        echo "✓ $skill_name (already linked)"
        ((skipped++))
      else
        echo "⚠️  $skill_name (symlink exists but points elsewhere: $current_target)"
        ((skipped++))
      fi
    else
      echo "⚠️  $skill_name (non-symlink already exists at top level)"
      ((skipped++))
    fi
  else
    # Create the symlink
    ln -s "$skill_dir" "$top_level_path"
    echo "✨ Created: $skill_name → $rel_path"
    ((created++))
  fi

  # Check if parent directory is already gitignored
  # If so, we should also gitignore the symlink (it's private)
  if git check-ignore -q "$parent_dir" 2>/dev/null; then
    symlinks_to_ignore+=("$skill_name")
  fi
done < <(find "$SKILLS_DIR" -mindepth 2 -name "SKILL.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -print0)

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Created: $created symlink(s)"
echo "⏭️  Skipped: $skipped (already exist)"

# Update .git/info/exclude to include symlinks to private (gitignored) skills
if [ ${#symlinks_to_ignore[@]} -gt 0 ]; then
  echo
  echo "📝 Updating .git/info/exclude..."

  # Get existing exclude entries
  existing_entries=""
  if [ -f "$GIT_EXCLUDE" ]; then
    existing_entries=$(cat "$GIT_EXCLUDE")
  fi

  # Build marker comments to identify our managed section
  marker_start="# Symlinks to private nested skills (managed by ln-nested-skills)"
  marker_end="# End managed section"

  # Remove old managed section if it exists
  if [ -f "$GIT_EXCLUDE" ] && grep -q "$marker_start" "$GIT_EXCLUDE"; then
    # Extract content before and after markers
    awk -v start="$marker_start" -v end="$marker_end" '
      $0 == start { skip=1; next }
      $0 == end { skip=0; next }
      !skip { print }
    ' "$GIT_EXCLUDE" > "$GIT_EXCLUDE.tmp"
    mv "$GIT_EXCLUDE.tmp" "$GIT_EXCLUDE"
  fi

  # Append new managed section
  {
    echo ""
    echo "$marker_start"
    printf '%s\n' "${symlinks_to_ignore[@]}" | sort -u
    echo "$marker_end"
  } >> "$GIT_EXCLUDE"

  echo "✓ Updated .git/info/exclude with ${#symlinks_to_ignore[@]} symlink(s)"
  echo "ℹ️  Only symlinks to gitignored directories were added"
fi

if [ $created -gt 0 ]; then
  echo
  echo "Run /reload-plugins to discover the new skills."
fi

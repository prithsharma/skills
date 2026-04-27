#!/bin/bash
# Shared validation and logging functions for Claude Code skills

# Validate UUID format
validate_session_id() {
    local session_id="$1"
    if ! [[ "$session_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        echo "ERROR: Invalid session ID format: $session_id" >&2
        return 1
    fi
    return 0
}

# Validate path is within expected directory (prevent traversal)
validate_path_in_directory() {
    local file_path="$1"
    local allowed_dir="$2"

    # Resolve to canonical paths
    local canonical_file=$(cd "$(dirname "$file_path")" 2>/dev/null && pwd -P)/$(basename "$file_path")
    local canonical_dir=$(cd "$allowed_dir" 2>/dev/null && pwd -P)

    if [ -z "$canonical_dir" ]; then
        echo "ERROR: Directory does not exist: $allowed_dir" >&2
        return 1
    fi

    if [[ "$canonical_file" != "$canonical_dir"/* ]]; then
        echo "ERROR: Path traversal detected. File must be in $allowed_dir" >&2
        return 1
    fi

    return 0
}

# Audit log for deletions
audit_log() {
    local action="$1"
    local target="$2"
    local details="$3"
    local log_file="$HOME/.claude/logs/deletion-audit.log"

    mkdir -p "$(dirname "$log_file")"
    echo "$(date -Iseconds) [$action] $target ${details:+| $details}" >> "$log_file"
}

# Validate file exists before operation
validate_file_exists() {
    local file_path="$1"
    if [ ! -f "$file_path" ]; then
        echo "ERROR: File does not exist: $file_path" >&2
        return 1
    fi
    return 0
}

# Get current project path dynamically
get_current_project_path() {
    # Try to get from current working directory hash
    local cwd_hash=$(echo -n "$(pwd)" | shasum -a 256 | cut -d' ' -f1 | head -c 40)
    local project_dir="$HOME/.claude/projects/-$(pwd | tr '/' '-')"

    if [ -d "$project_dir" ]; then
        echo "$project_dir"
        return 0
    fi

    # Fallback: find most recent session index
    local latest_index=$(find "$HOME/.claude/projects" -name "sessions-index.json" -type f -print0 | xargs -0 ls -t | head -1)
    if [ -n "$latest_index" ]; then
        echo "$(dirname "$latest_index")"
        return 0
    fi

    echo "ERROR: Cannot determine project path" >&2
    return 1
}

#!/usr/bin/env node
/**
 * granola-notion-sync.mjs
 * Syncs new Granola meeting notes → Work Notion Meeting Notes DB
 *
 * Usage:
 *   node scripts/granola-notion-sync.mjs [options]
 *
 * Options:
 *   --hours <n>     Look back N hours (default: 4). Takes priority over --days.
 *   --days <n>      Look back N days (converted to hours internally).
 *   --dry-run       Fetch + parse but don't write to Notion.
 *   --force-ids     Comma-separated meeting IDs to force-sync even if already synced.
 *
 * State file: memory/granola-sync-state.json
 *   synced_ids[]         — IDs already in Notion (skip these)
 *   last_sync            — ISO timestamp of last successful sync
 *   last_run_failed      — true if the last run errored out
 *   last_run_window_hours — how many hours the last run covered
 *
 * Failure catchup:
 *   If last_run_failed=true, effective_hours += last_run_window_hours
 *   so the next run covers the gap.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Processing flag ──────────────────────────────────────────────────────────
// When --no-process is passed, skip the processing step (sync only)
const SKIP_PROCESS = process.argv.includes("--no-process");

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, "..");
const MCPORTER = join(WORKSPACE, "node_modules/.bin/mcporter");

// ── Token refresh (must run before any mcporter calls) ────────────────────────
function refreshTokens() {
  // Granola: still uses refresh.py (direct HTTP refresh works for Granola)
  const granola = spawnSync("python3", [join(__dirname, "granola-refresh.py")], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (granola.error) {
    console.error(`[token-refresh] Failed to run granola-refresh.py:`, granola.error.message);
  } else if (granola.status !== 0) {
    console.error(`[token-refresh] granola-refresh.py exited ${granola.status}:`, granola.stderr || granola.stdout);
  } else {
    console.log(`[token-refresh] granola-refresh.py:`, (granola.stdout || "").trim());
  }

  // Notion: notion-refresh.py (direct HTTP) is retired — Notion's server 403s it.
  // mcporter handles Notion token refresh internally on first call; no pre-warm needed here.
  console.log("[token-refresh] notion: relying on mcporter internal refresh (notion-refresh.py retired)");
}

refreshTokens();
const STATE_FILE = join(WORKSPACE, "memory/granola-sync-state.json");
const NOTION_DB_ID = "8a9dd66e-abb7-45a2-937e-d9ee0fe49bc3";

// Per-call timeout for mcporter: 5 minutes (handles slow Granola/Notion API calls)
const MCPORTER_TIMEOUT_MS = 5 * 60 * 1000;

// Slack channel to post run summaries to
const SLACK_CHANNEL = "C0AQL12PRJL";

function postToSlack(message) {
  try {
    spawnSync(
      "openclaw",
      ["message", "send", "--channel", "slack", "--target", SLACK_CHANNEL, "--message", message],
      { cwd: WORKSPACE, encoding: "utf8", timeout: 15000 }
    );
  } catch (e) {
    console.error("[granola-sync] Failed to post to Slack:", e.message);
  }
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

let baseHours = 4;
if (args.includes("--hours")) {
  baseHours = parseFloat(args[args.indexOf("--hours") + 1]);
} else if (args.includes("--days")) {
  baseHours = parseFloat(args[args.indexOf("--days") + 1]) * 24;
}

const forceIdsArg = args.includes("--force-ids")
  ? args[args.indexOf("--force-ids") + 1].split(",").map((s) => s.trim())
  : [];

// ── State ────────────────────────────────────────────────────────────────────

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Effective lookback (failure catchup) ─────────────────────────────────────

const state = loadState();
const syncedIds = new Set(state.synced_ids || []);

let effectiveHours = baseHours;
if (state.last_run_failed && state.last_run_window_hours > 0) {
  effectiveHours += state.last_run_window_hours;
  console.log(
    `[granola-sync] Last run failed — extending lookback by ${state.last_run_window_hours}h → effective window: ${effectiveHours}h`
  );
}

// ── mcporter helper ──────────────────────────────────────────────────────────

function mcporter(server, tool, params = {}) {
  const paramArgs = Object.entries(params).map(([k, v]) => {
    if (typeof v === "object") return `${k}=${JSON.stringify(v)}`;
    return `${k}=${v}`;
  });
  const result = spawnSync(
    MCPORTER,
    ["call", `${server}.${tool}`, ...paramArgs],
    { cwd: WORKSPACE, encoding: "utf8", timeout: MCPORTER_TIMEOUT_MS }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseMeetingList(xml) {
  const meetings = [];
  const re = /<meeting id="([^"]+)" title="([^"]+)" date="([^"]+)">/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    meetings.push({ id: m[1], title: m[2], date: m[3] });
  }
  return meetings;
}

function extractSection(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : "";
}

function parseMeetingDetail(xml, meetingId) {
  // Extract just the block for this meeting ID (no "m" flag — dot-all via [\s\S])
  const re = new RegExp(
    `<meeting id="${meetingId}"[\\s\\S]*?(?=<meeting id=|</meetings_data>)`
  );
  const block = re.exec(xml)?.[0] || xml;

  const summary = extractSection(block, "summary");
  const notes = extractSection(block, "private_notes");

  const attendees = (() => {
    const pm = /<known_participants>([\s\S]*?)<\/known_participants>/.exec(block);
    if (!pm) return "";
    return pm[1]
      .trim()
      .split(",")
      .map((p) =>
        p.trim()
          .replace(/<[^>]+>/g, "")
          .replace(/\s+from\s+[\w]+\s*$/, "")
          .replace(/\(note creator\)/, "")
          .trim()
      )
      .filter(Boolean)
      .join(", ");
  })();

  return { summary, notes, attendees };
}

/**
 * Parse a Granola date string.
 *
 * Granola's MCP API returns date strings WITHOUT timezone metadata (e.g. "Mar 31, 2026 4:30 PM").
 * In practice, ~97% of meetings are organized from IST calendars and the raw string IS the IST time.
 * A small number of meetings organized from US/PDT calendars will have incorrect times — there is no
 * reliable way to distinguish these without a calendar integration (e.g. Google Calendar).
 *
 * We parse as local time (IST on this machine) as the best-effort default. If a meeting's time is
 * wrong in Notion, the fix requires an external calendar source of truth.
 *
 * Known edge case: the window-cutoff comparison below uses this same parsed date. To avoid meetings
 * near the window boundary being missed due to timezone ambiguity, the sync cron uses a generous
 * lookback window (--hours). Do not shrink this without understanding the TZ implications.
 */
function parseDate(dateStr) {
  try {
    return new Date(dateStr); // parsed as local time (IST on this machine)
  } catch {
    return new Date();
  }
}

/**
 * Format a Date as an ISO 8601 string with IST offset (+05:30).
 * Notion's datetime fields accept offset-aware strings, so this preserves
 * the correct local time instead of silently converting to UTC.
 */
function toISTIsoString(date) {
  const OFFSET_MINUTES = 5 * 60 + 30; // IST = UTC+5:30
  // Shift the UTC ms by the IST offset, then swap the trailing Z for +05:30
  const shifted = new Date(date.getTime() + OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().replace("Z", "+05:30");
}

function buildPageContent(summary, notes) {
  const parts = [];

  if (summary) {
    parts.push(summary.trim());
  }

  if (notes && notes.trim()) {
    // Heading toggle: "> ### Heading" creates a Notion toggle heading 3 block
    // Subsequent "> " lines are content inside the toggle
    const noteLines = notes
      .trim()
      .split(/\n+/)
      .map((l) => `> ${l.trim()}`)
      .filter((l) => l !== "> ")
      .join("\n");

    parts.push(`> ### Private Notes\n>\n${noteLines}`);
  }

  return parts.join("\n\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[granola-sync] Starting sync (last ${effectiveHours}h)${DRY_RUN ? " [DRY RUN]" : ""}`
  );

  const cutoff = new Date(Date.now() - effectiveHours * 60 * 60 * 1000);
  console.log(`[granola-sync] Cutoff: ${cutoff.toISOString()}`);

  // Pick the coarsest Granola time_range that covers our window
  const days = effectiveHours / 24;
  const timeRange =
    days <= 7 ? "this_week" : days <= 14 ? "last_week" : "last_30_days";

  console.log(`[granola-sync] Fetching meeting list (time_range=${timeRange})...`);
  let listXml;
  try {
    listXml = mcporter("granola", "list_meetings", { time_range: timeRange });
  } catch (e) {
    console.error("[granola-sync] Failed to list meetings:", e.message);
    saveState({
      ...state,
      last_run_failed: true,
      last_run_window_hours: effectiveHours,
    });
    postToSlack(`:x: *granola-notion-sync failed* (list meetings)\nWindow: ${effectiveHours}h\nError: ${e.message}`);
    process.exit(1);
  }

  const allMeetings = parseMeetingList(listXml);
  console.log(`[granola-sync] Found ${allMeetings.length} total meetings this period`);

  // Filter to cutoff window (and force-sync overrides)
  const inWindow = allMeetings.filter((m) => {
    if (forceIdsArg.includes(m.id)) return true;
    return parseDate(m.date) >= cutoff;
  });
  console.log(`[granola-sync] ${inWindow.length} meetings within ${effectiveHours}h window`);

  // Skip already synced (unless force-ids)
  const toSync = inWindow.filter(
    (m) => !syncedIds.has(m.id) || forceIdsArg.includes(m.id)
  );
  console.log(`[granola-sync] ${toSync.length} new / forced (skipping ${inWindow.length - toSync.length} already synced)`);

  if (toSync.length === 0) {
    console.log("[granola-sync] Nothing to sync.");
    saveState({
      ...state,
      synced_ids: [...syncedIds],
      last_sync: new Date().toISOString(),
      last_run_failed: false,
      last_run_window_hours: effectiveHours,
    });
    postToSlack(`:white_check_mark: *granola-notion-sync* — nothing new (window: ${effectiveHours}h, ${inWindow.length} meetings checked)`);
    return;
  }

  // Process in batches of 5
  const BATCH = 5;
  let synced = 0;
  let failed = 0;
  let processed = 0;
  let processFailed = 0;

  for (let i = 0; i < toSync.length; i += BATCH) {
    const batch = toSync.slice(i, i + BATCH);
    const ids = batch.map((m) => m.id);

    console.log(`[granola-sync] Fetching details for: ${ids.join(", ")}`);
    let detailXml;
    try {
      detailXml = mcporter("granola", "get_meetings", { meeting_ids: ids });
    } catch (e) {
      console.error("[granola-sync] Failed to get meeting details:", e.message);
      failed += batch.length;
      continue;
    }

    for (const meeting of batch) {
      const { summary, notes, attendees } = parseMeetingDetail(detailXml, meeting.id);
      const dateIso = toISTIsoString(parseDate(meeting.date));
      const granolaUrl = `https://notes.granola.ai/d/${meeting.id}`;
      const now = toISTIsoString(new Date());
      const pageContent = buildPageContent(summary, notes);

      console.log(
        `[granola-sync] ${DRY_RUN ? "[DRY RUN]" : "Syncing"}: ${meeting.title} (${meeting.date})`
      );
      if (DRY_RUN) {
        console.log(`  attendees: ${attendees || "(none)"}`);
        console.log(`  summary:   ${summary ? summary.slice(0, 120).replace(/\n/g, " ") + (summary.length > 120 ? "…" : "") : "(empty)"}`);
        console.log(`  notes:     ${notes ? notes.slice(0, 120).replace(/\n/g, " ") + (notes.length > 120 ? "…" : "") : "(empty)"}`);
        console.log(`  url:       ${granolaUrl}`);
        console.log(`  content:   ${pageContent ? pageContent.slice(0, 200).replace(/\n/g, " ") + (pageContent.length > 200 ? "…" : "") : "(empty)"}`);
      }

      if (!DRY_RUN) {
        try {
          mcporter("mcp-notion-com-mcp", "notion-create-pages", {
            parent: JSON.stringify({ type: "database_id", database_id: NOTION_DB_ID }),
            pages: JSON.stringify([
              {
                properties: {
                  Title: meeting.title,
                  "date:Date:start": dateIso,
                  "date:Date:is_datetime": 1,
                  Attendees: attendees,
                  "Granola ID": meeting.id,
                  "Granola URL": granolaUrl,
                  "date:Synced At:start": now,
                  "date:Synced At:is_datetime": 1,
                  "Processing Status": "synced",
                },
                content: pageContent,
              },
            ]),
          });
          syncedIds.add(meeting.id);
          synced++;
          console.log(`[granola-sync] ✓ Synced: ${meeting.title}`);

          // ── Inline processing: run process-meeting.js immediately ──
          if (!SKIP_PROCESS) {
            // Extract the Notion page ID from the create response
            let notionPageId = null;
            try {
              const createResult = mcporter("mcp-notion-com-mcp", "notion-search", {
                query: meeting.title,
                data_source_url: "collection://68b00749-f4a6-474d-8d46-85bce9769c4a",
                page_size: 1,
              });
              const searchResults = JSON.parse(createResult).results || [];
              if (searchResults.length > 0) notionPageId = searchResults[0].id;
            } catch (searchErr) {
              console.error(`[granola-sync] ⚠ Could not find Notion page for processing: ${searchErr.message}`);
            }

            if (notionPageId) {
              console.log(`[granola-sync] → Processing: ${meeting.title} (${notionPageId})`);
              const processScript = join(__dirname, "meeting-processor", "process-meeting.js");
              const processResult = spawnSync(
                process.execPath,
                [processScript, notionPageId],
                { encoding: "utf8", stdio: "pipe", timeout: 5 * 60 * 1000 }
              );
              if (processResult.status === 0) {
                console.log(`[granola-sync] ✓ Processed: ${meeting.title}`);
                processed++;
                if (processResult.stdout) {
                  // Extract key stats from output
                  const taskMatch = processResult.stdout.match(/Extracted: (\d+) tasks?, (\d+) decisions?/);
                  if (taskMatch) {
                    console.log(`[granola-sync]   ${taskMatch[1]} tasks, ${taskMatch[2]} decisions`);
                  }
                }
              } else {
                console.error(`[granola-sync] ✗ Processing failed for ${meeting.title}`);
                if (processResult.stderr) console.error(processResult.stderr.slice(0, 500));
                if (processResult.stdout) console.error(processResult.stdout.slice(0, 500));
                processFailed++;
              }
            } else {
              console.error(`[granola-sync] ✗ No Notion page ID found for ${meeting.title}, skipping processing`);
              processFailed++;
            }
          }
        } catch (e) {
          console.error(
            `[granola-sync] ✗ Failed to create Notion page for ${meeting.title}:`,
            e.message
          );
          failed++;
        }
      } else {
        syncedIds.add(meeting.id);
        synced++;
      }
    }
  }

  const runFailed = failed > 0 && synced === 0;
  if (!DRY_RUN) {
    saveState({
      ...state,
      synced_ids: [...syncedIds],
      last_sync: new Date().toISOString(),
      last_run_failed: runFailed,
      last_run_window_hours: effectiveHours,
    });
  }

  console.log(`[granola-sync] Done. ${synced} synced, ${failed} failed, ${processed} processed, ${processFailed} process-failed.`);

  if (!DRY_RUN) {
    const processNote = SKIP_PROCESS ? "" : `\n• ${processed} processed, ${processFailed} process-failed`;
    if (runFailed) {
      postToSlack(`:x: *granola-notion-sync failed* — ${synced} synced, ${failed} failed${processNote}\nWindow: ${effectiveHours}h\n_[source: scripts/granola-notion-sync.mjs]_`);
      process.exit(1);
    } else if (failed > 0 || processFailed > 0) {
      postToSlack(`:warning: *granola-notion-sync partial* — ${synced} synced, ${failed} sync-failed${processNote}\nWindow: ${effectiveHours}h\n_[source: scripts/granola-notion-sync.mjs]_`);
    } else {
      postToSlack(`:white_check_mark: *granola-notion-sync* — ${synced} meeting${synced === 1 ? "" : "s"} synced${processNote}\nWindow: ${effectiveHours}h\n_[source: scripts/granola-notion-sync.mjs]_`);
    }
  }
}

main().catch((e) => {
  console.error("[granola-sync] Fatal:", e);
  if (!DRY_RUN) {
    saveState({
      ...state,
      last_run_failed: true,
      last_run_window_hours: effectiveHours,
    });
    postToSlack(`:x: *granola-notion-sync fatal error*\nWindow: ${effectiveHours}h\nError: ${e.message}\n_[source: scripts/granola-notion-sync.mjs]_`);
  }
  process.exit(1);
});

#!/usr/bin/env node
/**
 * followup-cron.mjs — Follow-up sender cron
 *
 * Runs every 3 hours. Queries Work Notion for Waiting On tasks with:
 *   Follow-up Status = scheduled
 *   Follow-up Due <= now
 *
 * For each due task:
 *   1. Reads the task page body for assignee, Slack ID, meeting, action item, category
 *   2. Crafts a follow-up DM message (quick-delivery vs open-loop tone)
 *   3. Batches all drafts and posts to #logs on personal Slack for approval
 *
 * After Prithvi approves (manual step for now — cron writes draft, human approves):
 *   The follow-up-sender.mjs script handles the actual send + Notion update.
 *
 * Categories:
 *   quick-delivery — clear deliverable (ticket, doc, update). Tone: direct reminder. Cadence: 12h.
 *   open-loop      — process/proposal/discussion. Tone: soft check-in. Cadence: 36h.
 *
 * Task page body format expected:
 *   Assignee: [Name] | [Slack ID]
 *   Meeting: [Meeting Name] | [Granola URL]
 *   Action item: [verbatim]
 *   Category: quick-delivery | open-loop
 *   Follow-up count: N
 *   Last follow-up: —
 *   Context: [optional]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Workspace = skill root when run from skill dir, or WORKSPACE env override
const WORKSPACE = process.env.WORKSPACE || path.resolve(__dirname, '..');
const LOG_FILE = path.join(WORKSPACE, 'memory', 'followup-cron.log');
const DRAFT_FILE = path.join(WORKSPACE, 'memory', 'followup-drafts.json');
// Config: resolve from env vars (set by caller or .env), with no hardcoded defaults
const PERSONAL_SLACK_TOKEN = process.env.PERSONAL_SLACK_TOKEN
  || (() => { try { return execSync('security find-generic-password -a "bot-token" -s "openclaw-slack" -w', { encoding: 'utf8' }).trim(); } catch { return ''; } })();
const LOGS_CHANNEL = process.env.LOGS_CHANNEL || (() => { throw new Error('LOGS_CHANNEL env var required — set to your Slack channel ID for follow-up approvals'); })();
const TASKS_DS = process.env.TASKS_DS || (() => { throw new Error('TASKS_DS env var required — set to your Notion Tasks datasource ID'); })();
const ESCALATION_THRESHOLD = parseInt(process.env.ESCALATION_THRESHOLD || '3', 10);
const WORK_SLACK_TOKEN_CMD = process.env.WORK_SLACK_TOKEN_CMD
  || `security find-generic-password -a "bot-token" -s "openclaw-slack-work" -w`;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stderr.write(line);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mcpCallSync(tool, args) {
  const cmd = `npx mcporter call mcp-notion-com-mcp.${tool} --args '${JSON.stringify(args).replace(/'/g, "'\\''")}'`;
  try {
    const out = execSync(cmd, { cwd: WORKSPACE, encoding: 'utf8', timeout: 30000, env: { ...process.env, MCPORTER_PORT: '0' } });
    return JSON.parse(out);
  } catch (e) {
    log(`ERROR mcpCall ${tool}: ${e.message}`);
    return null;
  }
}

// Serialized async wrapper — waits between calls to avoid mcporter port conflicts
async function mcpCall(tool, args) {
  await sleep(300); // 300ms between calls
  return mcpCallSync(tool, args);
}

function slackPost(token, channel, text) {
  const payload = JSON.stringify({ channel, text });
  const cmd = `curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '${payload.replace(/'/g, "'\\''")}'`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (e) {
    log(`ERROR slackPost: ${e.message}`);
    return null;
  }
}

function parseTaskBody(bodyText) {
  // Parse the structured page body into key-value pairs
  const result = {};
  if (!bodyText) return result;
  const lines = bodyText.split('\n');
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      result[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }
  return result;
}

function parseAssignee(assigneeStr) {
  // "Name | Slack ID" or just "Name"
  if (!assigneeStr) return { name: 'Unknown', slackId: null };
  const parts = assigneeStr.split('|').map(s => s.trim());
  return { name: parts[0] || 'Unknown', slackId: parts[1] || null };
}

function parseMeeting(meetingStr) {
  // "Meeting Name | Granola URL"
  if (!meetingStr) return { name: 'meeting', url: null };
  const parts = meetingStr.split('|').map(s => s.trim());
  return { name: parts[0] || 'meeting', url: parts[1] || null };
}

function craftMessage(taskBody, taskTitle) {
  const { name: assigneeName } = parseAssignee(taskBody['assignee']);
  const { name: meetingName, url: meetingUrl } = parseMeeting(taskBody['meeting']);
  const actionItem = taskBody['action item'] || taskTitle || 'the action item';
  const category = (taskBody['category'] || 'quick-delivery').toLowerCase();
  const meetingLink = meetingUrl ? `<${meetingUrl}|${meetingName}>` : meetingName;

  if (category === 'open-loop') {
    return `Hey ${assigneeName} — wanted to make sure *${actionItem}* from ${meetingLink} is on your radar. No rush — reply to Prithvi directly if you have an update or want to connect.`;
  } else {
    // quick-delivery
    return `Hey ${assigneeName} — just a reminder on *${actionItem}* from ${meetingLink}. Reply to Prithvi directly when done.`;
  }
}

// Look up Slack user ID by name via work Slack users.list
function resolveSlackId(workToken, name) {
  try {
    const payload = JSON.stringify({ limit: 200 });
    const cmd = `curl -s -X POST "https://slack.com/api/users.list" \
      -H "Authorization: Bearer ${workToken}" \
      -H "Content-Type: application/json" \
      -d '${payload}'`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    const result = JSON.parse(out);
    if (!result.ok || !result.members) return null;
    const nameLower = name.toLowerCase();
    const member = result.members.find(m =>
      (m.real_name || '').toLowerCase() === nameLower ||
      (m.profile?.display_name || '').toLowerCase() === nameLower ||
      (m.profile?.real_name || '').toLowerCase() === nameLower ||
      (m.real_name || '').toLowerCase().startsWith(nameLower)
    );
    return member ? { id: member.id, realName: member.real_name } : null;
  } catch (e) {
    log(`ERROR resolveSlackId(${name}): ${e.message}`);
    return null;
  }
}

function getFollowupCount(taskBody) {
  const raw = taskBody['follow-up count'] || '0';
  return parseInt(raw, 10) || 0;
}

async function main() {
  log('followup-cron: starting');
  const now = new Date();
  const nowIso = now.toISOString();

  // Query Work Notion: Waiting On + Follow-up Status = scheduled + Follow-up Due <= now
  const searchResult = await mcpCall('notion-search', {
    query: 'a',
    query_type: 'internal',
    data_source_url: `collection://${TASKS_DS}`,
    page_size: 25,
  });

  if (!searchResult || !searchResult.results) {
    log('followup-cron: no results or error from Notion search');
    return;
  }

  log(`followup-cron: got ${searchResult.results.length} tasks from Notion, filtering...`);

  const dueTasks = [];

  for (const task of searchResult.results) {
    // Skip archived/test entries
    if (task.title && task.title.includes('[ARCHIVED')) continue;

    // Fetch full page to get properties + body
    const pageId = task.id || task.url;
    if (!pageId) continue;

    const page = await mcpCall('notion-fetch', { id: pageId });
    if (!page) continue;

    // Extract properties from page text
    const pageText = page.text || '';

    // Check Type = Waiting On
    if (!pageText.includes('Waiting On')) continue;

    // Check Follow-up Status = scheduled (must be explicit, not just substring)
    if (!pageText.match(/Follow-up Status[^:]*:\s*scheduled/i)) continue;

    // Check Follow-up Due <= now
    const dueDateMatch = pageText.match(/Follow-up Due[^|]*\|\s*([0-9T:Z.+-]+)/i)
      || pageText.match(/date:Follow-up Due:start[^:]*:\s*([0-9T:Z.+-]+)/i)
      || pageText.match(/Follow-up Due[^:]*:\s*([0-9T:Z.+-]+)/i);
    if (!dueDateMatch) {
      log(`SKIP ${task.title}: no Follow-up Due date found`);
      continue;
    }
    const dueDate = new Date(dueDateMatch[1]);
    if (isNaN(dueDate.getTime())) {
      log(`SKIP ${task.title}: unparseable date ${dueDateMatch[1]}`);
      continue;
    }
    if (dueDate > now) {
      log(`SKIP ${task.title}: not due yet (${dueDate.toISOString()})`);
      continue;
    }

    // Parse title
    const taskTitle = task.title || 'Untitled';

    // Parse body content
    const taskBody = parseTaskBody(pageText);
    const followupCount = getFollowupCount(taskBody);

    dueTasks.push({
      id: pageId,
      title: taskTitle,
      taskBody,
      followupCount,
      message: craftMessage(taskBody, taskTitle),
    });
  }

  log(`followup-cron: ${dueTasks.length} tasks due for follow-up`);

  if (dueTasks.length === 0) {
    log('followup-cron: nothing to do');
    return;
  }

  // Slack IDs should be resolved at task creation time (by the meeting subagent).
  // Here we just read what's stored. If still "unknown", attempt a fallback lookup.
  let workToken = null;
  try {
    workToken = execSync(WORK_SLACK_TOKEN_CMD, { encoding: 'utf8' }).trim();
  } catch (e) {
    log(`WARN: could not get work Slack token — fallback ID lookup unavailable: ${e.message}`);
  }

  for (const task of dueTasks) {
    const { name, slackId } = parseAssignee(task.taskBody['assignee']);
    if (slackId && slackId !== 'unknown') {
      // Already resolved at creation time — just use it
      task.resolvedSlackId = slackId;
      task.resolvedName = name;
      task.slackResolved = true;
    } else if (workToken && name && name !== 'Unknown') {
      // Fallback: try to resolve now (creation-time lookup may have failed)
      log(`WARN: Slack ID for "${name}" is unknown — attempting fallback lookup`);
      const found = resolveSlackId(workToken, name);
      if (found) {
        task.resolvedSlackId = found.id;
        task.resolvedName = found.realName;
        task.slackResolved = true;
        log(`Fallback resolved ${name} → ${found.id} (${found.realName})`);
        // Write resolved ID back to Notion page body
        const page = await mcpCall('notion-fetch', { id: task.id });
        if (page) {
          const updated = (page.text || '').replace(
            /^Assignee:.*$/m,
            `Assignee: ${found.realName} | ${found.id}`
          );
          await mcpCall('notion-update-page', {
            page_id: task.id,
            command: 'replace_content',
            new_str: updated,
          });
        }
      } else {
        task.resolvedSlackId = null;
        task.resolvedName = name;
        task.slackResolved = false;
        log(`WARN: fallback lookup also failed for "${name}"`);
      }
    } else {
      task.resolvedSlackId = null;
      task.resolvedName = name;
      task.slackResolved = false;
    }
  }

  // Separate escalations from normal
  const escalations = dueTasks.filter(t => t.followupCount >= ESCALATION_THRESHOLD);
  const normal = dueTasks.filter(t => t.followupCount < ESCALATION_THRESHOLD);

  // Build approval message for #logs
  const dateStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Calcutta', day: 'numeric', month: 'short' });
  let slackText = `*📬 Follow-up drafts — ${dateStr}*\n_[source: scripts/followup-cron.mjs]_\n`;
  slackText += `${normal.length} DM(s) ready. Reply *send* to approve all, *skip [name]* to skip, *resolve [name]* to mark done.\n`;
  slackText += `To correct a name/ID: *correct [name]=U0SLACKID*\n\n`;

  for (const task of normal) {
    const statusIcon = task.slackResolved ? '✅' : '⚠️';
    const idInfo = task.slackResolved
      ? `${task.resolvedName} (${task.resolvedSlackId})`
      : `${task.resolvedName} — _Slack ID not found, reply \`correct ${task.resolvedName}=U0XXXXX\`_`;
    slackText += `*To: ${statusIcon} ${idInfo}*\n`;
    slackText += `> ${task.message}\n`;
    slackText += `_Task: ${task.title}_\n\n`;
  }

  if (escalations.length > 0) {
    slackText += `\n⚠️ *Escalation needed (${ESCALATION_THRESHOLD}+ follow-ups, no response):*\n`;
    for (const task of escalations) {
      const { name } = parseAssignee(task.taskBody['assignee']);
      slackText += `• ${name} — "${task.title}" (${task.followupCount} follow-ups sent)\n`;
    }
    slackText += `\nReply *escalate [name]* or *drop [name]* for each.`;
  }

  // Save drafts to file for the send step
  const drafts = {
    createdAt: nowIso,
    status: 'pending_approval',
    tasks: dueTasks.map(t => ({
      notionId: t.id,
      title: t.title,
      assignee: t.taskBody['assignee'],
      resolvedName: t.resolvedName,
      resolvedSlackId: t.resolvedSlackId,
      slackResolved: t.slackResolved,
      message: t.message,
      followupCount: t.followupCount,
      category: t.taskBody['category'] || 'quick-delivery',
      isEscalation: t.followupCount >= ESCALATION_THRESHOLD,
    })),
  };

  fs.writeFileSync(DRAFT_FILE, JSON.stringify(drafts, null, 2));
  log(`followup-cron: wrote ${dueTasks.length} drafts to ${DRAFT_FILE}`);

  // Post to #logs for approval
  const result = slackPost(PERSONAL_SLACK_TOKEN, LOGS_CHANNEL, slackText);
  if (result && result.ok) {
    log(`followup-cron: posted approval request to #logs (ts: ${result.ts})`);
  } else {
    log(`followup-cron: failed to post to #logs: ${JSON.stringify(result)}`);
  }

  log('followup-cron: done');
}

main().catch(e => {
  log(`followup-cron: FATAL: ${e.message}`);
  process.exit(1);
});

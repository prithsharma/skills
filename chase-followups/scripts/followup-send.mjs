#!/usr/bin/env node
/**
 * followup-send.mjs — Executes approved follow-up DMs
 *
 * Called by main session after Prithvi approves a batch in #logs.
 *
 * Usage:
 *   node followup-send.mjs [--skip "Name1,Name2"] [--resolve "Name3"]
 *
 * Reads: memory/followup-drafts.json
 * Sends: DMs via ps_claw (work Slack)
 * Updates: Notion task (Follow-up Status, count, next due)
 * Writes: results summary to memory/followup-send-log.jsonl
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.WORKSPACE || path.resolve(__dirname, '..');
const DRAFTS_FILE = path.join(WORKSPACE, 'memory', 'followup-drafts.json');
const SEND_LOG = path.join(WORKSPACE, 'memory', 'followup-send-log.jsonl');
const LOG_FILE = path.join(WORKSPACE, 'memory', 'followup-cron.log');
const TASKS_DS = process.env.TASKS_DS || (() => { throw new Error('TASKS_DS env var required — set to your Notion Tasks datasource ID'); })();

// Cadence for next follow-up
const NEXT_DUE_HOURS = { 'quick-delivery': 24, 'open-loop': 48 };
const ESCALATION_THRESHOLD = 3;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] followup-send: ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stderr.write(line);
}

function getWorkSlackToken() {
  try {
    return execSync(
      `security find-generic-password -a "bot-token" -s "openclaw-slack-work" -w`,
      { encoding: 'utf8' }
    ).trim();
  } catch (e) {
    log(`ERROR: could not get work Slack token: ${e.message}`);
    return null;
  }
}

function slackApiCall(token, endpoint, payload) {
  const payloadStr = JSON.stringify(payload).replace(/'/g, "'\\''");
  const cmd = `curl -s -X POST "https://slack.com/api/${endpoint}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '${payloadStr}'`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (e) {
    log(`ERROR slackApiCall ${endpoint}: ${e.message}`);
    return null;
  }
}

// Look up Slack user ID by name via work Slack users.list
function resolveSlackId(token, name) {
  log(`Resolving Slack ID for: ${name}`);
  const result = slackApiCall(token, 'users.list', { limit: 200 });
  if (!result || !result.ok || !result.members) {
    log(`ERROR: users.list failed`);
    return null;
  }
  const nameLower = name.toLowerCase();
  // Try exact display name, real name, or first name match
  const member = result.members.find(m =>
    (m.real_name || '').toLowerCase() === nameLower ||
    (m.profile?.display_name || '').toLowerCase() === nameLower ||
    (m.profile?.real_name || '').toLowerCase() === nameLower ||
    (m.real_name || '').toLowerCase().startsWith(nameLower)
  );
  if (member) {
    log(`Resolved ${name} → ${member.id} (${member.real_name})`);
    return member.id;
  }
  log(`WARN: could not resolve Slack ID for "${name}"`);
  return null;
}

// Open a DM channel and get its ID
function openDmChannel(token, userId) {
  const result = slackApiCall(token, 'conversations.open', { users: userId });
  if (!result || !result.ok) {
    log(`ERROR: conversations.open failed for ${userId}: ${JSON.stringify(result)}`);
    return null;
  }
  return result.channel?.id;
}

function mcpCall(tool, args) {
  const cmd = `npx mcporter call mcp-notion-com-mcp.${tool} --args '${JSON.stringify(args).replace(/'/g, "'\\''")}'`;
  try {
    const out = execSync(cmd, { cwd: WORKSPACE, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(out);
  } catch (e) {
    log(`ERROR mcpCall ${tool}: ${e.message}`);
    return null;
  }
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

// Update page body: bump follow-up count and last follow-up date
function updatePageBody(pageId, currentBody, newCount, nowIso) {
  const updatedBody = currentBody
    .replace(/^Follow-up count:.*$/m, `Follow-up count: ${newCount}`)
    .replace(/^Last follow-up:.*$/m, `Last follow-up: ${nowIso}`);

  // If no match (body wasn't templated), append
  const hasCount = /^Follow-up count:/m.test(currentBody);
  const finalBody = hasCount ? updatedBody :
    currentBody + `\nFollow-up count: ${newCount}\nLast follow-up: ${nowIso}`;

  mcpCall('notion-update-page', {
    page_id: pageId,
    command: 'replace_content',
    new_str: finalBody,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const skipArg = args.find(a => a.startsWith('--skip='))?.replace('--skip=', '') || '';
  const resolveArg = args.find(a => a.startsWith('--resolve='))?.replace('--resolve=', '') || '';

  const skipNames = skipArg ? skipArg.split(',').map(s => s.trim().toLowerCase()) : [];
  const resolveNames = resolveArg ? resolveArg.split(',').map(s => s.trim().toLowerCase()) : [];

  log(`starting — skip: [${skipNames.join(', ')}], resolve: [${resolveNames.join(', ')}]`);

  if (!fs.existsSync(DRAFTS_FILE)) {
    log('ERROR: no drafts file found');
    process.exit(1);
  }

  const drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
  if (drafts.status !== 'pending_approval') {
    log(`WARN: drafts status is "${drafts.status}" — already processed?`);
  }

  const workToken = getWorkSlackToken();
  if (!workToken) {
    log('ERROR: no work Slack token — aborting');
    process.exit(1);
  }

  const now = new Date();
  const results = [];

  for (const task of drafts.tasks) {
    const assigneeName = (task.assignee || '').split('|')[0].trim();
    const assigneeSlackId = (task.assignee || '').split('|')[1]?.trim();
    const nameLower = assigneeName.toLowerCase();

    // Handle resolve
    if (resolveNames.includes(nameLower)) {
      log(`Marking resolved: ${task.title}`);
      mcpCall('notion-update-page', {
        page_id: task.notionId,
        command: 'update_properties',
        properties: { 'Follow-up Status': 'resolved' },
      });
      results.push({ task: task.title, action: 'resolved', ts: now.toISOString() });
      continue;
    }

    // Handle skip
    if (skipNames.includes(nameLower)) {
      log(`Skipping: ${task.title}`);
      results.push({ task: task.title, action: 'skipped', ts: now.toISOString() });
      continue;
    }

    // Handle escalation
    if (task.isEscalation) {
      log(`Skipping escalated task (needs manual decision): ${task.title}`);
      results.push({ task: task.title, action: 'escalation_pending', ts: now.toISOString() });
      continue;
    }

    // Use pre-resolved ID from cron if available, otherwise fall back to lookup
    let slackId = task.resolvedSlackId || ((assigneeSlackId && assigneeSlackId !== 'unknown') ? assigneeSlackId : null);
    if (!slackId && assigneeName) {
      slackId = resolveSlackId(workToken, assigneeName);
    }

    if (!slackId) {
      log(`ERROR: no Slack ID for "${assigneeName}" — skipping send, marking needs_slack_id`);
      results.push({ task: task.title, action: 'failed_no_slack_id', assignee: assigneeName, ts: now.toISOString() });
      continue;
    }

    // Update page body with resolved Slack ID if it was unknown
    if (!assigneeSlackId || assigneeSlackId === 'unknown') {
      const page = mcpCall('notion-fetch', { id: task.notionId });
      if (page) {
        const pageText = page.text || '';
        const updatedText = pageText.replace(/^Assignee:.*$/m, `Assignee: ${assigneeName} | ${slackId}`);
        mcpCall('notion-update-page', {
          page_id: task.notionId,
          command: 'replace_content',
          new_str: updatedText,
        });
        log(`Updated Slack ID for ${assigneeName} → ${slackId}`);
      }
    }

    // Open DM and send
    const dmChannel = openDmChannel(workToken, slackId);
    if (!dmChannel) {
      log(`ERROR: could not open DM with ${assigneeName} (${slackId})`);
      results.push({ task: task.title, action: 'failed_dm_open', ts: now.toISOString() });
      continue;
    }

    const sendResult = slackApiCall(workToken, 'chat.postMessage', {
      channel: dmChannel,
      text: task.message,
    });

    if (!sendResult || !sendResult.ok) {
      log(`ERROR: send failed for ${assigneeName}: ${JSON.stringify(sendResult)}`);
      results.push({ task: task.title, action: 'failed_send', error: sendResult?.error, ts: now.toISOString() });
      continue;
    }

    log(`Sent DM to ${assigneeName} (${slackId}): ${sendResult.ts}`);

    // Update Notion: Follow-up Status → sent, then reset to scheduled with next due
    const newCount = (task.followupCount || 0) + 1;
    const category = task.category || 'quick-delivery';
    const nextDueHours = NEXT_DUE_HOURS[category] || 24;
    const nextDue = addHours(now, nextDueHours);

    const newStatus = newCount >= ESCALATION_THRESHOLD ? 'escalated' : 'scheduled';

    mcpCall('notion-update-page', {
      page_id: task.notionId,
      command: 'update_properties',
      properties: {
        'Follow-up Status': newStatus,
        'date:Follow-up Due:start': nextDue,
        'date:Follow-up Due:is_datetime': 1,
      },
    });

    // Update page body with new count + timestamp
    const page = mcpCall('notion-fetch', { id: task.notionId });
    if (page) {
      const pageText = page.text || '';
      updatePageBody(task.notionId, pageText, newCount, now.toISOString());
    }

    results.push({
      task: task.title,
      action: 'sent',
      slackTs: sendResult.ts,
      nextDue,
      newCount,
      newStatus,
      ts: now.toISOString(),
    });
  }

  // Mark drafts as processed
  drafts.status = 'sent';
  drafts.processedAt = now.toISOString();
  drafts.results = results;
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));

  // Append to send log
  fs.appendFileSync(SEND_LOG, JSON.stringify({ runAt: now.toISOString(), results }) + '\n');

  // Summary
  const sent = results.filter(r => r.action === 'sent').length;
  const failed = results.filter(r => r.action.startsWith('failed')).length;
  const skipped = results.filter(r => ['skipped', 'resolved', 'escalation_pending'].includes(r.action)).length;

  log(`done — sent: ${sent}, failed: ${failed}, skipped/resolved: ${skipped}`);

  // Print summary to stdout for caller
  console.log(JSON.stringify({ sent, failed, skipped, results }));
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// token-tracker.js — Claude Code session-start hook
// Reads session JSONL files, calculates weekly token usage,
// and outputs an efficiency tier as hook context.

const fs = require("fs");
const path = require("path");

// --- Config ---
const CONFIG_PATH = path.join(__dirname, "config.json");
const LOG_PATH = path.join(__dirname, "usage-log.csv");
const DEFAULT_CLAUDE_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude"
);

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
} catch {
  process.stderr.write("token-tracker: could not read config.json\n");
  process.exit(0);
}

const CLAUDE_DIR = config.claudeDir || DEFAULT_CLAUDE_DIR;
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

// --- Week boundary ---
function getWeekStart() {
  const dayMap = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const startDay = dayMap[(config.weekStartDay || "monday").toLowerCase()] ?? 1;
  const now = new Date();
  const current = now.getDay();
  let diff = current - startDay;
  if (diff < 0) diff += 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// --- Scan sessions ---
function getWeeklyUsage() {
  const weekStart = getWeekStart();
  const totals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  let sessionCount = 0;
  let apiCalls = 0;

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return { totals, sessionCount, apiCalls };
  }

  for (const projDir of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projDir);
    let stat;
    try {
      stat = fs.statSync(projPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const filePath = path.join(projPath, file);
      let content;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      let fileHadUsage = false;
      const lines = content.split("\n");

      for (const line of lines) {
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        // Only count final API responses (have iterations field)
        const usage = obj.message?.usage;
        if (!usage || usage.iterations === undefined) continue;

        // Check timestamp is within current week
        if (obj.timestamp) {
          const ts = new Date(obj.timestamp);
          if (ts < weekStart) continue;
        }

        totals.input += usage.input_tokens || 0;
        totals.output += usage.output_tokens || 0;
        totals.cacheCreation += usage.cache_creation_input_tokens || 0;
        totals.cacheRead += usage.cache_read_input_tokens || 0;
        apiCalls++;
        fileHadUsage = true;
      }

      if (fileHadUsage) sessionCount++;
    }
  }

  return { totals, sessionCount, apiCalls };
}

// --- Calculate weighted total ---
function weightedTotal(totals) {
  const w = config.tokenWeights || { input: 1, output: 1, cacheCreation: 1, cacheRead: 0.1 };
  return (
    totals.input * (w.input ?? 1) +
    totals.output * (w.output ?? 1) +
    totals.cacheCreation * (w.cacheCreation ?? 1) +
    totals.cacheRead * (w.cacheRead ?? 0.1)
  );
}

// --- Determine tier ---
function determineTier(percentUsed, projectedPercent) {
  const t = config.tiers;
  // Use the WORSE of actual vs projected to be conservative
  if (percentUsed <= t.normal.maxPercentUsed && projectedPercent <= t.normal.maxPercentProjected) {
    return "normal";
  }
  if (percentUsed <= t.conservative.maxPercentUsed && projectedPercent <= t.conservative.maxPercentProjected) {
    return "conservative";
  }
  return "survival";
}

// --- Main ---
const { totals, sessionCount, apiCalls } = getWeeklyUsage();
const weighted = weightedTotal(totals);
const budget = config.weeklyBudgetTokens;
const percentUsed = (weighted / budget) * 100;

// Day-of-week progress
const weekStart = getWeekStart();
const now = new Date();
const msElapsed = now - weekStart;
const daysElapsed = Math.max(msElapsed / (1000 * 60 * 60 * 24), 0.1);
const daysRemaining = Math.max(7 - daysElapsed, 0);

// Burn rate projection
const dailyRate = weighted / daysElapsed;
const projectedWeekly = dailyRate * 7;
const projectedPercent = (projectedWeekly / budget) * 100;

const tier = determineTier(percentUsed, projectedPercent);

// --- Log ---
try {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, "timestamp,weighted_tokens,percent_used,projected_percent,tier,days_elapsed,sessions,api_calls,raw_input,raw_output,raw_cache_create,raw_cache_read\n");
  }
  const logLine = [
    now.toISOString(),
    Math.round(weighted),
    percentUsed.toFixed(1),
    projectedPercent.toFixed(0),
    tier,
    daysElapsed.toFixed(1),
    sessionCount,
    apiCalls,
    totals.input,
    totals.output,
    totals.cacheCreation,
    totals.cacheRead,
  ].join(",");
  fs.appendFileSync(LOG_PATH, logLine + "\n");
} catch {
  // Non-fatal
}

// --- Format numbers ---
function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

// --- Build tier behavior description ---
const tierDescriptions = {
  normal: "Standard efficiency. Use best tools for the job. Subagents and exploration are fine when warranted.",
  conservative: "Elevated efficiency. Prefer Sonnet for subagents. Shorter responses. Batch tool calls aggressively. Skip speculative exploration. No insights unless asked.",
  survival: "Maximum efficiency. Haiku for all subagents. Bare minimum output. No insights. No speculative reads. Targeted edits only. Ask before any multi-step exploration.",
};

// --- Output hook JSON ---
const status = [
  `TOKEN BUDGET: ${percentUsed.toFixed(0)}% used (${fmtTokens(weighted)} weighted), ${daysRemaining.toFixed(1)} days remaining.`,
  `Burn rate: ${fmtTokens(dailyRate)}/day — projected ${projectedPercent.toFixed(0)}% by week end.`,
  `Sessions this week: ${sessionCount}, API calls: ${apiCalls}.`,
  `EFFICIENCY TIER: ${tier.toUpperCase()}.`,
  tierDescriptions[tier],
].join(" ");

const hookOutput = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: status,
  },
};

console.log(JSON.stringify(hookOutput));

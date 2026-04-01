#!/usr/bin/env node
// token-tracker.js — Claude Code session-start hook
// Fetches real usage data from Anthropic's API and outputs an efficiency tier.

const fs = require("fs");
const path = require("path");
const https = require("https");

// --- Defaults ---
const DEFAULT_CONFIG = {
  tiers: {
    normal: { maxBurnRatio: 1.2, effortLevel: "high" },
    conservative: { maxBurnRatio: 1.8, effortLevel: "medium" },
    survival: { effortLevel: "low" },
  },
  fiveHourThresholds: {
    conservative: 75,
    survival: 90,
  },
};

// Default tier behaviors. Users can override these in their CLAUDE.md under
// a "Token Budget Tiers" section — CLAUDE.md instructions take precedence.
const TIER_DESCRIPTIONS = {
  normal: "Standard efficiency. Use best tools for the job. Subagents and exploration are fine when warranted.",
  conservative: "Elevated efficiency. Prefer Sonnet for subagents. Shorter responses. Batch tool calls aggressively. Skip speculative exploration. No insights unless asked.",
  survival: "Maximum efficiency. Haiku for all subagents. Bare minimum output. No insights. No speculative reads. Targeted edits only. Ask before any multi-step exploration.",
};

// --- Pure functions ---

function getWeekProgress(resetsAt, now) {
  if (!resetsAt) return null;
  const reset = new Date(resetsAt);
  now = now || new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekStart = new Date(reset.getTime() - weekMs);
  const elapsed = now - weekStart;
  return Math.max(0, Math.min(100, (elapsed / weekMs) * 100));
}

function determineTier(weeklyPercent, fiveHourPercent, weekProgress, config) {
  const tiers = config.tiers || DEFAULT_CONFIG.tiers;
  const fiveHourThresholds = config.fiveHourThresholds || DEFAULT_CONFIG.fiveHourThresholds;

  // 5-hour window critical override (burst protection)
  if (fiveHourPercent >= fiveHourThresholds.survival) return "survival";
  if (fiveHourPercent >= fiveHourThresholds.conservative) return "conservative";

  // Too early to judge weekly pacing
  if (weeklyPercent < 5 && (weekProgress === null || weekProgress < 5)) return "normal";

  // Weekly pacing: compare usage rate to time rate
  const burnRatio = weeklyPercent / Math.max(weekProgress ?? 1, 1);

  if (burnRatio <= tiers.normal.maxBurnRatio) return "normal";
  if (burnRatio <= tiers.conservative.maxBurnRatio) return "conservative";
  return "survival";
}

function formatResetTime(isoString, now) {
  if (!isoString) return "unknown";
  const reset = new Date(isoString);
  now = now || new Date();
  const hoursLeft = Math.max((reset - now) / (1000 * 60 * 60), 0);
  if (hoursLeft < 1) return `${Math.round(hoursLeft * 60)}m`;
  if (hoursLeft < 48) return `${hoursLeft.toFixed(1)}h`;
  return `${(hoursLeft / 24).toFixed(1)}d`;
}

function getEffortAdvice(currentEffort, recommendedEffort) {
  if (currentEffort === recommendedEffort) return "";
  return `Recommend switching effort level from "${currentEffort}" to "${recommendedEffort}" — tell the user: 'Consider running /config to set effort to ${recommendedEffort}, or start with --effort ${recommendedEffort}'.`;
}

function buildOutput(usage, config, currentEffort, now) {
  const mergedConfig = {
    tiers: { ...DEFAULT_CONFIG.tiers, ...config.tiers },
    fiveHourThresholds: { ...DEFAULT_CONFIG.fiveHourThresholds, ...config.fiveHourThresholds },
  };

  const fiveHour = usage.five_hour?.utilization ?? 0;
  const weekly = usage.seven_day?.utilization ?? 0;
  const weeklySonnet = usage.seven_day_sonnet?.utilization ?? null;
  const weeklyOpus = usage.seven_day_opus?.utilization ?? null;
  const fiveHourReset = formatResetTime(usage.five_hour?.resets_at, now);
  const weeklyReset = formatResetTime(usage.seven_day?.resets_at, now);
  const weekProgress = getWeekProgress(usage.seven_day?.resets_at, now);

  const tier = determineTier(weekly, fiveHour, weekProgress, mergedConfig);
  const recommendedEffort = mergedConfig.tiers[tier]?.effortLevel || "high";
  const effortAdvice = getEffortAdvice(currentEffort, recommendedEffort);

  // Pacing description
  let pacing;
  if (weekProgress !== null && weekProgress >= 5 && weekly >= 5) {
    const ratio = weekly / Math.max(weekProgress, 1);
    if (ratio <= 0.8) pacing = "well under budget";
    else if (ratio <= 1.0) pacing = "on pace";
    else if (ratio <= 1.2) pacing = "slightly ahead of pace";
    else if (ratio <= 1.5) pacing = "ahead of pace";
    else pacing = "significantly ahead of pace";
  } else if (weekProgress !== null && weekProgress < 5) {
    pacing = "too early in the week to assess";
  }

  const parts = [
    `TOKEN BUDGET: Weekly ${weekly}% used, ${weekProgress !== null ? Math.round(weekProgress) + "%" : "?"} through the week (resets in ${weeklyReset}). Session window: ${fiveHour}% (resets in ${fiveHourReset}).`,
  ];

  if (pacing) parts.push(`Pacing: ${pacing}.`);
  if (weeklySonnet !== null) parts.push(`Sonnet-only: ${weeklySonnet}%.`);
  if (weeklyOpus !== null) parts.push(`Opus-only: ${weeklyOpus}%.`);

  parts.push(
    `EFFICIENCY TIER: ${tier.toUpperCase()}.`,
    `Default behavior for this tier: ${TIER_DESCRIPTIONS[tier]}`,
    `If the user's CLAUDE.md defines custom behaviors for this tier, follow those instead.`
  );

  if (effortAdvice) parts.push(effortAdvice);

  return {
    tier,
    weekProgress,
    pacing,
    hookOutput: {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: parts.join(" "),
      },
    },
    logEntry: {
      fiveHour,
      weekly,
      weeklySonnet,
      weeklyOpus,
      weekProgress: weekProgress !== null ? Math.round(weekProgress) : "",
      tier,
    },
  };
}

// --- I/O functions ---

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function getCurrentEffortLevel(claudeDir) {
  const envEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  if (envEffort) return envEffort.toLowerCase();

  try {
    const settingsPath = path.join(claudeDir, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    if (settings.effortLevel) return settings.effortLevel.toLowerCase();
  } catch {
    // Fall through
  }

  return "high"; // Claude Code default
}

function fetchUsage(credentialsPath) {
  return new Promise((resolve, reject) => {
    let creds;
    try {
      creds = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    } catch {
      reject(new Error("Could not read credentials"));
      return;
    }

    const token = creds.claudeAiOauth?.accessToken;
    if (!token) {
      reject(new Error("No OAuth token found"));
      return;
    }

    const options = {
      hostname: "api.anthropic.com",
      path: "/api/oauth/usage",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
        "User-Agent": "claude-token-tracker/1.0",
      },
      timeout: 5000,
    };

    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function appendLog(logPath, entry) {
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, "timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,week_progress_pct,tier\n");
    }
    const logLine = [
      new Date().toISOString(),
      entry.fiveHour,
      entry.weekly,
      entry.weeklySonnet ?? "",
      entry.weeklyOpus ?? "",
      entry.weekProgress,
      entry.tier,
    ].join(",");
    fs.appendFileSync(logPath, logLine + "\n");
  } catch {
    // Non-fatal
  }
}

// --- Main ---
async function main() {
  const configPath = path.join(__dirname, "config.json");
  const claudeDir = path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
  const dataDir = path.join(claudeDir, "token-tracker");
  const logPath = path.join(dataDir, "usage-log.csv");
  const credentialsPath = path.join(claudeDir, ".credentials.json");

  const config = loadConfig(configPath);

  let usage;
  try {
    usage = await fetchUsage(credentialsPath);
  } catch (err) {
    process.stderr.write(`token-tracker: ${err.message}\n`);
    process.exit(0);
  }

  if (usage.type === "error") {
    process.stderr.write(`token-tracker: API error: ${usage.error?.message}\n`);
    process.exit(0);
  }

  const currentEffort = getCurrentEffortLevel(claudeDir);
  const result = buildOutput(usage, config, currentEffort);

  appendLog(logPath, result.logEntry);
  console.log(JSON.stringify(result.hookOutput));
}

// Run as CLI or export for testing
if (require.main === module) {
  main();
} else {
  module.exports = {
    determineTier,
    formatResetTime,
    getWeekProgress,
    getEffortAdvice,
    buildOutput,
    getCurrentEffortLevel,
    TIER_DESCRIPTIONS,
    DEFAULT_CONFIG,
  };
}

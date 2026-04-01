#!/usr/bin/env node
// token-tracker.js — Claude Code session-start hook
// Fetches real usage data from Anthropic's API and outputs an efficiency tier.

const fs = require("fs");
const path = require("path");
const https = require("https");

// --- Config ---
const CONFIG_PATH = path.join(__dirname, "config.json");
const LOG_PATH = path.join(__dirname, "usage-log.csv");
const CLAUDE_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude"
);
const CREDENTIALS_PATH = path.join(CLAUDE_DIR, ".credentials.json");

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
} catch {
  process.stderr.write("token-tracker: could not read config.json\n");
  process.exit(0);
}

// --- Effort level detection ---
function getCurrentEffortLevel() {
  // Env var overrides settings (matches Claude Code behavior)
  const envEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  if (envEffort) return envEffort.toLowerCase();

  // Read from settings.json
  try {
    const settingsPath = path.join(CLAUDE_DIR, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    if (settings.effortLevel) return settings.effortLevel.toLowerCase();
  } catch {
    // Fall through
  }

  return "high"; // Claude Code default
}

// --- Tier logic ---
function determineTier(weeklyPercent, fiveHourPercent) {
  const t = config.tiers;
  if (weeklyPercent <= t.normal.maxWeekly && fiveHourPercent <= t.normal.maxFiveHour) {
    return "normal";
  }
  if (weeklyPercent <= t.conservative.maxWeekly && fiveHourPercent <= t.conservative.maxFiveHour) {
    return "conservative";
  }
  return "survival";
}

// Default tier behaviors. Users can override these in their CLAUDE.md under
// a "Token Budget Tiers" section — CLAUDE.md instructions take precedence.
const tierDescriptions = {
  normal: "Standard efficiency. Use best tools for the job. Subagents and exploration are fine when warranted.",
  conservative: "Elevated efficiency. Prefer Sonnet for subagents. Shorter responses. Batch tool calls aggressively. Skip speculative exploration. No insights unless asked.",
  survival: "Maximum efficiency. Haiku for all subagents. Bare minimum output. No insights. No speculative reads. Targeted edits only. Ask before any multi-step exploration.",
};

// --- Fetch usage from Anthropic API ---
function fetchUsage() {
  return new Promise((resolve, reject) => {
    let creds;
    try {
      creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
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

// --- Format reset time ---
function formatResetTime(isoString) {
  if (!isoString) return "unknown";
  const reset = new Date(isoString);
  const now = new Date();
  const hoursLeft = Math.max((reset - now) / (1000 * 60 * 60), 0);
  if (hoursLeft < 1) return `${Math.round(hoursLeft * 60)}m`;
  if (hoursLeft < 48) return `${hoursLeft.toFixed(1)}h`;
  return `${(hoursLeft / 24).toFixed(1)}d`;
}

// --- Main ---
async function main() {
  let usage;
  try {
    usage = await fetchUsage();
  } catch (err) {
    process.stderr.write(`token-tracker: ${err.message}\n`);
    // Fail silently — don't block session start
    process.exit(0);
  }

  if (usage.type === "error") {
    process.stderr.write(`token-tracker: API error: ${usage.error?.message}\n`);
    process.exit(0);
  }

  const fiveHour = usage.five_hour?.utilization ?? 0;
  const weekly = usage.seven_day?.utilization ?? 0;
  const weeklySonnet = usage.seven_day_sonnet?.utilization ?? null;
  const weeklyOpus = usage.seven_day_opus?.utilization ?? null;
  const fiveHourReset = formatResetTime(usage.five_hour?.resets_at);
  const weeklyReset = formatResetTime(usage.seven_day?.resets_at);

  const tier = determineTier(weekly, fiveHour);

  // --- Log ---
  try {
    if (!fs.existsSync(LOG_PATH)) {
      fs.writeFileSync(
        LOG_PATH,
        "timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,tier\n"
      );
    }
    const logLine = [
      new Date().toISOString(),
      fiveHour,
      weekly,
      weeklySonnet ?? "",
      weeklyOpus ?? "",
      tier,
    ].join(",");
    fs.appendFileSync(LOG_PATH, logLine + "\n");
  } catch {
    // Non-fatal
  }

  // --- Effort level advice ---
  const currentEffort = getCurrentEffortLevel();
  const recommendedEffort = config.tiers[tier]?.effortLevel || "high";
  let effortAdvice = "";
  if (currentEffort !== recommendedEffort) {
    effortAdvice = ` Recommend switching effort level from "${currentEffort}" to "${recommendedEffort}" — tell the user: 'Consider running /config to set effort to ${recommendedEffort}, or start with --effort ${recommendedEffort}'.`;
  }

  // --- Build context ---
  const parts = [
    `TOKEN BUDGET: Weekly ${weekly}% used (resets in ${weeklyReset}), session ${fiveHour}% used (resets in ${fiveHourReset}).`,
  ];

  if (weeklySonnet !== null) parts.push(`Sonnet-only: ${weeklySonnet}%.`);
  if (weeklyOpus !== null) parts.push(`Opus-only: ${weeklyOpus}%.`);

  parts.push(
    `EFFICIENCY TIER: ${tier.toUpperCase()}.`,
    `Default behavior for this tier: ${tierDescriptions[tier]}`,
    `If the user's CLAUDE.md defines custom behaviors for this tier, follow those instead.`
  );

  if (effortAdvice) parts.push(effortAdvice);

  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join(" "),
    },
  };

  console.log(JSON.stringify(hookOutput));
}

main();

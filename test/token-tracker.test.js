const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
  determineTier,
  formatResetTime,
  getEffortAdvice,
  buildOutput,
  DEFAULT_CONFIG,
  TIER_DESCRIPTIONS,
} = require("../token-tracker");

// --- determineTier ---

describe("determineTier", () => {
  const tiers = DEFAULT_CONFIG.tiers;

  it("returns normal when both metrics are low", () => {
    assert.equal(determineTier(0, 0, tiers), "normal");
    assert.equal(determineTier(10, 30, tiers), "normal");
    assert.equal(determineTier(50, 70, tiers), "normal");
  });

  it("returns conservative when weekly exceeds normal but not conservative", () => {
    assert.equal(determineTier(51, 0, tiers), "conservative");
    assert.equal(determineTier(80, 90, tiers), "conservative");
  });

  it("returns conservative when five-hour exceeds normal but not conservative", () => {
    assert.equal(determineTier(0, 71, tiers), "conservative");
    assert.equal(determineTier(50, 90, tiers), "conservative");
  });

  it("returns survival when weekly exceeds conservative", () => {
    assert.equal(determineTier(81, 0, tiers), "survival");
    assert.equal(determineTier(100, 100, tiers), "survival");
  });

  it("returns survival when five-hour exceeds conservative", () => {
    assert.equal(determineTier(0, 91, tiers), "survival");
  });

  it("uses the worse of the two metrics", () => {
    // Weekly is fine (10%) but five-hour is critical (95%)
    assert.equal(determineTier(10, 95, tiers), "survival");
    // Five-hour is fine (10%) but weekly is critical (85%)
    assert.equal(determineTier(85, 10, tiers), "survival");
  });

  it("handles boundary values", () => {
    assert.equal(determineTier(50, 70, tiers), "normal");
    assert.equal(determineTier(50, 71, tiers), "conservative");
    assert.equal(determineTier(51, 70, tiers), "conservative");
    assert.equal(determineTier(80, 90, tiers), "conservative");
    assert.equal(determineTier(80, 91, tiers), "survival");
    assert.equal(determineTier(81, 90, tiers), "survival");
  });

  it("works with custom tier thresholds", () => {
    const custom = {
      normal: { maxWeekly: 30, maxFiveHour: 40 },
      conservative: { maxWeekly: 60, maxFiveHour: 70 },
    };
    assert.equal(determineTier(30, 40, custom), "normal");
    assert.equal(determineTier(31, 40, custom), "conservative");
    assert.equal(determineTier(61, 0, custom), "survival");
  });
});

// --- formatResetTime ---

describe("formatResetTime", () => {
  it("returns 'unknown' for null/undefined input", () => {
    assert.equal(formatResetTime(null), "unknown");
    assert.equal(formatResetTime(undefined), "unknown");
  });

  it("returns minutes when less than 1 hour away", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-01T12:30:00Z";
    assert.equal(formatResetTime(reset, now), "30m");
  });

  it("returns hours when less than 48 hours away", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-02T12:00:00Z";
    assert.equal(formatResetTime(reset, now), "24.0h");
  });

  it("returns days when 48+ hours away", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-08T12:00:00Z";
    assert.equal(formatResetTime(reset, now), "7.0d");
  });

  it("returns 0m for past reset times", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-01T10:00:00Z";
    assert.equal(formatResetTime(reset, now), "0m");
  });

  it("handles edge at exactly 1 hour", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-01T13:00:00Z";
    assert.equal(formatResetTime(reset, now), "1.0h");
  });

  it("handles edge at exactly 48 hours", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const reset = "2026-04-03T12:00:00Z";
    assert.equal(formatResetTime(reset, now), "2.0d");
  });
});

// --- getEffortAdvice ---

describe("getEffortAdvice", () => {
  it("returns empty string when effort matches", () => {
    assert.equal(getEffortAdvice("high", "high"), "");
    assert.equal(getEffortAdvice("low", "low"), "");
  });

  it("returns advice when effort doesn't match", () => {
    const advice = getEffortAdvice("high", "low");
    assert.ok(advice.includes('"high"'));
    assert.ok(advice.includes('"low"'));
    assert.ok(advice.includes("--effort low"));
  });
});

// --- buildOutput ---

describe("buildOutput", () => {
  const baseUsage = {
    five_hour: { utilization: 30, resets_at: "2026-04-01T17:00:00Z" },
    seven_day: { utilization: 10, resets_at: "2026-04-08T07:00:00Z" },
    seven_day_sonnet: { utilization: 5, resets_at: "2026-04-02T02:00:00Z" },
    seven_day_opus: null,
  };

  it("returns valid hook output structure", () => {
    const result = buildOutput(baseUsage, {}, "high");
    assert.ok(result.hookOutput.hookSpecificOutput);
    assert.equal(result.hookOutput.hookSpecificOutput.hookEventName, "SessionStart");
    assert.ok(typeof result.hookOutput.hookSpecificOutput.additionalContext === "string");
  });

  it("includes utilization percentages in output", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Weekly 10% used"));
    assert.ok(ctx.includes("session 30% used"));
  });

  it("includes sonnet percentage when present", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Sonnet-only: 5%"));
  });

  it("excludes opus when null", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes("Opus"));
  });

  it("includes opus when present", () => {
    const usage = {
      ...baseUsage,
      seven_day_opus: { utilization: 8, resets_at: "2026-04-08T07:00:00Z" },
    };
    const result = buildOutput(usage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Opus-only: 8%"));
  });

  it("determines correct tier", () => {
    assert.equal(buildOutput(baseUsage, {}, "high").tier, "normal");

    const highUsage = {
      ...baseUsage,
      seven_day: { utilization: 85, resets_at: "2026-04-08T07:00:00Z" },
    };
    assert.equal(buildOutput(highUsage, {}, "high").tier, "survival");
  });

  it("includes tier description in output", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("EFFICIENCY TIER: NORMAL"));
    assert.ok(ctx.includes(TIER_DESCRIPTIONS.normal));
  });

  it("includes CLAUDE.md override instruction", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("CLAUDE.md defines custom behaviors"));
  });

  it("suppresses effort advice when matching", () => {
    const result = buildOutput(baseUsage, {}, "high");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes("Recommend switching"));
  });

  it("includes effort advice when mismatched", () => {
    const result = buildOutput(baseUsage, {}, "low");
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Recommend switching"));
    assert.ok(ctx.includes('"low"'));
    assert.ok(ctx.includes('"high"'));
  });

  it("returns log entry with correct fields", () => {
    const result = buildOutput(baseUsage, {}, "high");
    assert.equal(result.logEntry.fiveHour, 30);
    assert.equal(result.logEntry.weekly, 10);
    assert.equal(result.logEntry.weeklySonnet, 5);
    assert.equal(result.logEntry.weeklyOpus, null);
    assert.equal(result.logEntry.tier, "normal");
  });

  it("handles missing usage fields gracefully", () => {
    const result = buildOutput({}, {}, "high");
    assert.equal(result.tier, "normal");
    assert.equal(result.logEntry.fiveHour, 0);
    assert.equal(result.logEntry.weekly, 0);
  });

  it("respects custom tier thresholds from config", () => {
    const config = {
      tiers: {
        normal: { maxWeekly: 10, maxFiveHour: 10, effortLevel: "high" },
        conservative: { maxWeekly: 20, maxFiveHour: 20, effortLevel: "medium" },
        survival: { effortLevel: "low" },
      },
    };
    // 10/30 would be normal with defaults, but conservative with tight thresholds
    const result = buildOutput(baseUsage, config, "high");
    assert.equal(result.tier, "survival");
  });
});

// --- CLI integration ---

describe("CLI integration", () => {
  it("outputs valid JSON to stdout", () => {
    const script = path.join(__dirname, "..", "token-tracker.js");
    let output;
    try {
      output = execSync(`node "${script}"`, {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env },
      });
    } catch (e) {
      // Script may exit 0 with no output if no credentials
      if (e.status === 0) return;
      throw e;
    }

    const parsed = JSON.parse(output.trim());
    assert.ok(parsed.hookSpecificOutput);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes("TOKEN BUDGET"));
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes("EFFICIENCY TIER"));
  });

  it("exits cleanly with bad credentials path", () => {
    const script = path.join(__dirname, "..", "token-tracker.js");
    try {
      execSync(`node "${script}"`, {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          USERPROFILE: "/nonexistent",
          HOME: "/nonexistent",
        },
      });
    } catch (e) {
      // Should exit 0 (silent failure), not crash
      assert.equal(e.status, 0);
    }
  });

  it("respects CLAUDE_CODE_EFFORT_LEVEL env var", () => {
    const script = path.join(__dirname, "..", "token-tracker.js");
    let output;
    try {
      output = execSync(`node "${script}"`, {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: "low" },
      });
    } catch (e) {
      if (e.status === 0) return;
      throw e;
    }

    const parsed = JSON.parse(output.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Normal tier recommends high, so with low set there should be advice
    if (ctx.includes("TIER: NORMAL")) {
      assert.ok(ctx.includes("Recommend switching"));
    }
  });
});

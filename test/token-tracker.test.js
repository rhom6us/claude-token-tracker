const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execSync } = require("child_process");

const {
  determineTier,
  formatResetTime,
  getWeekProgress,
  getEffortAdvice,
  buildOutput,
  DEFAULT_CONFIG,
  TIER_DESCRIPTIONS,
} = require("../token-tracker");

// --- getWeekProgress ---

describe("getWeekProgress", () => {
  it("returns null for null/undefined input", () => {
    assert.equal(getWeekProgress(null), null);
    assert.equal(getWeekProgress(undefined), null);
  });

  it("returns 0 at the start of the week", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(getWeekProgress(resetsAt, now), 0);
  });

  it("returns 50 at the midpoint", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    const now = new Date("2026-04-05T00:00:00Z");
    assert.equal(getWeekProgress(resetsAt, now), 50);
  });

  it("returns 100 at the reset point", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    const now = new Date("2026-04-08T12:00:00Z");
    assert.equal(getWeekProgress(resetsAt, now), 100);
  });

  it("clamps to 0 if before the week started", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    const now = new Date("2026-03-31T00:00:00Z");
    assert.equal(getWeekProgress(resetsAt, now), 0);
  });

  it("clamps to 100 if after the reset", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    const now = new Date("2026-04-10T00:00:00Z");
    assert.equal(getWeekProgress(resetsAt, now), 100);
  });

  it("returns correct fractional progress", () => {
    const resetsAt = "2026-04-08T12:00:00Z";
    // 1 day into the week = 1/7 ≈ 14.29%
    const now = new Date("2026-04-02T12:00:00Z");
    const progress = getWeekProgress(resetsAt, now);
    assert.ok(Math.abs(progress - 14.2857) < 0.01);
  });
});

// --- determineTier ---

describe("determineTier", () => {
  const config = DEFAULT_CONFIG;

  it("returns normal when burn ratio is low", () => {
    // 20% tokens, 50% through week → ratio 0.4
    assert.equal(determineTier(20, 0, 50, config), "normal");
  });

  it("returns normal at 90% tokens if 95% through week", () => {
    // ratio = 90/95 ≈ 0.95 — on pace
    assert.equal(determineTier(90, 0, 95, config), "normal");
  });

  it("returns normal when both usage and progress are very low", () => {
    // Early bailout: weeklyPercent < 5 && weekProgress < 5
    assert.equal(determineTier(3, 0, 2, config), "normal");
    assert.equal(determineTier(0, 0, 0, config), "normal");
  });

  it("returns conservative when burn ratio exceeds 1.2 but not 1.8", () => {
    // 40% tokens, 30% through week → ratio ≈ 1.33
    assert.equal(determineTier(40, 0, 30, config), "conservative");
  });

  it("returns survival when burn ratio exceeds 1.8", () => {
    // 80% tokens, 30% through week → ratio ≈ 2.67
    assert.equal(determineTier(80, 0, 30, config), "survival");
  });

  // --- Five-hour burst protection ---

  it("five-hour burst triggers conservative at 75%", () => {
    assert.equal(determineTier(10, 75, 50, config), "conservative");
  });

  it("five-hour burst triggers survival at 90%", () => {
    assert.equal(determineTier(10, 90, 50, config), "survival");
  });

  it("five-hour overrides even when weekly pacing is fine", () => {
    assert.equal(determineTier(5, 92, 95, config), "survival");
  });

  // --- Boundary values ---

  it("exactly at maxBurnRatio 1.2 is normal", () => {
    // 60% tokens, 50% progress → ratio = 1.2
    assert.equal(determineTier(60, 0, 50, config), "normal");
  });

  it("just over maxBurnRatio 1.2 is conservative", () => {
    // 61% tokens, 50% progress → ratio = 1.22
    assert.equal(determineTier(61, 0, 50, config), "conservative");
  });

  it("exactly at maxBurnRatio 1.8 is conservative", () => {
    // 90% tokens, 50% progress → ratio = 1.8
    assert.equal(determineTier(90, 0, 50, config), "conservative");
  });

  it("just over maxBurnRatio 1.8 is survival", () => {
    // 91% tokens, 50% progress → ratio = 1.82
    assert.equal(determineTier(91, 0, 50, config), "survival");
  });

  it("five-hour boundary at exactly 75 is conservative", () => {
    assert.equal(determineTier(10, 75, 50, config), "conservative");
  });

  it("five-hour boundary at exactly 90 is survival", () => {
    assert.equal(determineTier(10, 90, 50, config), "survival");
  });

  // --- Edge cases ---

  it("handles null weekProgress with low usage (early bailout)", () => {
    assert.equal(determineTier(3, 0, null, config), "normal");
  });

  it("handles null weekProgress with significant usage", () => {
    // weekProgress=null → Math.max(null ?? 1, 1) = 1, burnRatio = 20/1 = 20 → survival
    assert.equal(determineTier(20, 0, null, config), "survival");
  });

  it("handles weekProgress of 0 with usage ≥ 5", () => {
    // Math.max(0, 1) = 1, burnRatio = 10/1 = 10 → survival
    assert.equal(determineTier(10, 0, 0, config), "survival");
  });

  // --- Custom config ---

  it("respects custom burn ratio thresholds", () => {
    const custom = {
      tiers: {
        normal: { maxBurnRatio: 1.0, effortLevel: "high" },
        conservative: { maxBurnRatio: 1.5, effortLevel: "medium" },
        survival: { effortLevel: "low" },
      },
      fiveHourThresholds: { conservative: 75, survival: 90 },
    };
    // ratio = 40/30 ≈ 1.33 → above 1.0 → conservative
    assert.equal(determineTier(40, 0, 30, custom), "conservative");
  });

  it("respects custom five-hour thresholds", () => {
    const custom = {
      tiers: DEFAULT_CONFIG.tiers,
      fiveHourThresholds: { conservative: 60, survival: 80 },
    };
    assert.equal(determineTier(10, 60, 50, custom), "conservative");
    assert.equal(determineTier(10, 80, 50, custom), "survival");
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
    assert.equal(formatResetTime("2026-04-01T12:30:00Z", now), "30m");
  });

  it("returns hours when less than 48 hours away", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(formatResetTime("2026-04-02T12:00:00Z", now), "24.0h");
  });

  it("returns days when 48+ hours away", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(formatResetTime("2026-04-08T12:00:00Z", now), "7.0d");
  });

  it("returns 0m for past reset times", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(formatResetTime("2026-04-01T10:00:00Z", now), "0m");
  });

  it("handles edge at exactly 1 hour", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(formatResetTime("2026-04-01T13:00:00Z", now), "1.0h");
  });

  it("handles edge at exactly 48 hours", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    assert.equal(formatResetTime("2026-04-03T12:00:00Z", now), "2.0d");
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
  // Pin "now" to 2026-04-05T00:00:00Z — 50% through the week
  const now = new Date("2026-04-05T00:00:00Z");
  const baseUsage = {
    five_hour: { utilization: 30, resets_at: "2026-04-05T05:00:00Z" },
    seven_day: { utilization: 10, resets_at: "2026-04-08T12:00:00Z" },
    seven_day_sonnet: { utilization: 5, resets_at: "2026-04-08T12:00:00Z" },
    seven_day_opus: null,
  };

  it("returns valid hook output structure", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    assert.ok(result.hookOutput.hookSpecificOutput);
    assert.equal(result.hookOutput.hookSpecificOutput.hookEventName, "SessionStart");
    assert.ok(typeof result.hookOutput.hookSpecificOutput.additionalContext === "string");
  });

  it("includes utilization percentages in output", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Weekly 10% used"));
    assert.ok(ctx.includes("Session window: 30%"));
  });

  it("includes week progress in output", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("through the week"));
  });

  it("includes pacing description", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Pacing:"));
  });

  it("includes sonnet percentage when present", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Sonnet-only: 5%"));
  });

  it("excludes opus when null", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes("Opus"));
  });

  it("includes opus when present", () => {
    const usage = {
      ...baseUsage,
      seven_day_opus: { utilization: 8, resets_at: "2026-04-08T12:00:00Z" },
    };
    const result = buildOutput(usage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Opus-only: 8%"));
  });

  it("determines correct tier based on pacing", () => {
    // 10% weekly at 50% through week → ratio 0.2 → normal
    assert.equal(buildOutput(baseUsage, {}, "high", now).tier, "normal");

    // 85% weekly at 50% through week → ratio 1.7 → conservative
    const highUsage = {
      ...baseUsage,
      seven_day: { utilization: 85, resets_at: "2026-04-08T12:00:00Z" },
    };
    assert.equal(buildOutput(highUsage, {}, "high", now).tier, "conservative");

    // 95% weekly at 50% through week → ratio 1.9 → survival
    const criticalUsage = {
      ...baseUsage,
      seven_day: { utilization: 95, resets_at: "2026-04-08T12:00:00Z" },
    };
    assert.equal(buildOutput(criticalUsage, {}, "high", now).tier, "survival");
  });

  it("includes tier description in output", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("EFFICIENCY TIER: NORMAL"));
    assert.ok(ctx.includes(TIER_DESCRIPTIONS.normal));
  });

  it("includes CLAUDE.md override instruction", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("CLAUDE.md defines custom behaviors"));
  });

  it("suppresses effort advice when matching", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes("Recommend switching"));
  });

  it("includes effort advice when mismatched", () => {
    const result = buildOutput(baseUsage, {}, "low", now);
    const ctx = result.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("Recommend switching"));
    assert.ok(ctx.includes('"low"'));
    assert.ok(ctx.includes('"high"'));
  });

  it("returns log entry with correct fields", () => {
    const result = buildOutput(baseUsage, {}, "high", now);
    assert.equal(result.logEntry.fiveHour, 30);
    assert.equal(result.logEntry.weekly, 10);
    assert.equal(result.logEntry.weeklySonnet, 5);
    assert.equal(result.logEntry.weeklyOpus, null);
    assert.equal(result.logEntry.tier, "normal");
    assert.ok(typeof result.logEntry.weekProgress === "number");
  });

  it("handles missing usage fields gracefully", () => {
    const result = buildOutput({}, {}, "high", now);
    assert.equal(result.logEntry.fiveHour, 0);
    assert.equal(result.logEntry.weekly, 0);
  });

  it("respects custom config thresholds", () => {
    const config = {
      tiers: {
        normal: { maxBurnRatio: 0.5, effortLevel: "high" },
        conservative: { maxBurnRatio: 1.0, effortLevel: "medium" },
        survival: { effortLevel: "low" },
      },
    };
    // 10% weekly at 50% progress → ratio 0.2 → still normal (below 0.5)
    assert.equal(buildOutput(baseUsage, config, "high", now).tier, "normal");

    // 40% weekly at 50% progress → ratio 0.8 → conservative (above 0.5, below 1.0)
    const usage40 = { ...baseUsage, seven_day: { utilization: 40, resets_at: "2026-04-08T12:00:00Z" } };
    assert.equal(buildOutput(usage40, config, "high", now).tier, "conservative");
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
    if (ctx.includes("TIER: NORMAL")) {
      assert.ok(ctx.includes("Recommend switching"));
    }
  });
});

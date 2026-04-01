# claude-token-tracker

A session-start hook for [Claude Code](https://claude.com/claude-code) that fetches your real usage data from Anthropic's API and automatically adjusts Claude's efficiency behavior based on how close you are to your limits.

## Problem

Claude Code (Max plan) has rolling 5-hour and weekly usage limits, but there's no built-in way to automatically throttle behavior as you approach them. You either burn through your quota fast or manually check `/usage` and tell Claude to be more careful.

## Solution

A Node.js script that runs as a Claude Code `SessionStart` hook:

1. Reads your OAuth token from `~/.claude/.credentials.json`
2. Calls Anthropic's usage API to get your real utilization percentages
3. Injects an efficiency tier (`NORMAL`, `CONSERVATIVE`, or `SURVIVAL`) into the session context
4. Logs usage to CSV for historical tracking

No token counting, no approximations — it uses the same data that powers the `/usage` dialog.

## Setup

### 1. Clone

```bash
git clone https://github.com/rhom6us/claude-token-tracker
```

### 2. Add the hook to your Claude Code settings

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-token-tracker/token-tracker.js",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 3. (Optional) Customize tier behaviors

The hook injects sensible default behaviors for each tier. To override them, define your own in `~/.claude/CLAUDE.md`:

```markdown
### Token Budget Tiers
- **NORMAL** — [your custom behavior]
- **CONSERVATIVE** — [your custom behavior]
- **SURVIVAL** — [your custom behavior]
```

CLAUDE.md instructions take precedence over the hook's defaults, so you only need to add this if you want different behavior.

## Configuration

`config.json`:

| Field | Description | Default |
|-------|-------------|---------|
| `tiers.normal.maxBurnRatio` | Max burn ratio for NORMAL tier | `1.2` |
| `tiers.normal.effortLevel` | Recommended effort level for NORMAL | `"high"` |
| `tiers.conservative.maxBurnRatio` | Max burn ratio for CONSERVATIVE | `1.8` |
| `tiers.conservative.effortLevel` | Recommended effort level for CONSERVATIVE | `"medium"` |
| `tiers.survival.effortLevel` | Recommended effort level for SURVIVAL | `"low"` |
| `fiveHourThresholds.conservative` | 5-hour % that triggers CONSERVATIVE | `75` |
| `fiveHourThresholds.survival` | 5-hour % that triggers SURVIVAL | `90` |

## How it works

Claude Code stores an OAuth token in `~/.claude/.credentials.json`. The script uses this token to call `GET https://api.anthropic.com/api/oauth/usage`, which returns real utilization percentages — the same data that powers the `/usage` dialog:

```json
{
  "five_hour": { "utilization": 64, "resets_at": "2026-04-01T09:00:00Z" },
  "seven_day": { "utilization": 2, "resets_at": "2026-04-08T07:00:00Z" },
  "seven_day_sonnet": { "utilization": 0, "resets_at": "2026-04-02T02:00:00Z" }
}
```

### Pacing-based tier logic

The tier is determined by comparing your **token consumption rate** to **time passage rate** using a **burn ratio**:

```
burn ratio = weekly usage % / week progress %
```

- A ratio of **1.0** means you're using tokens at exactly the rate time is passing — perfectly on pace.
- A ratio of **0.5** means you've used half as many tokens as time would suggest — well under budget.
- A ratio of **2.0** means you're burning tokens twice as fast as time is passing — danger zone.

| Burn Ratio | Tier | Meaning |
|-----------|------|---------|
| ≤ 1.2 | NORMAL | On pace or under budget |
| 1.2 – 1.8 | CONSERVATIVE | Ahead of pace |
| > 1.8 | SURVIVAL | Significantly ahead of pace |

The **5-hour session window** acts as a burst protection override — if your 5-hour utilization hits 75% you'll get CONSERVATIVE, and at 90% you'll get SURVIVAL, regardless of weekly pacing.

## Output

Each session start appends a row to `~/.claude/token-tracker/usage-log.csv`:

```
timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,week_progress_pct,tier
```

Use the `/burndown` skill to visualize usage history as a line graph comparing actual usage against ideal pace.

## Requirements

- Claude Code with OAuth login (Max or Pro plan)
- Node.js (bundled with Claude Code)

## License

MIT

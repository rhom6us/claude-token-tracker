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
| `tiers.normal.maxWeekly` | Max weekly % for NORMAL tier | `50` |
| `tiers.normal.maxFiveHour` | Max 5-hour % for NORMAL tier | `70` |
| `tiers.normal.effortLevel` | Recommended effort level for NORMAL | `"high"` |
| `tiers.conservative.maxWeekly` | Max weekly % for CONSERVATIVE | `80` |
| `tiers.conservative.maxFiveHour` | Max 5-hour % for CONSERVATIVE | `90` |
| `tiers.conservative.effortLevel` | Recommended effort level for CONSERVATIVE | `"medium"` |
| `tiers.survival.effortLevel` | Recommended effort level for SURVIVAL | `"low"` |

## How it works

Claude Code stores an OAuth token in `~/.claude/.credentials.json`. The script uses this token to call `GET https://api.anthropic.com/api/oauth/usage`, which returns real utilization percentages — the same data that powers the `/usage` dialog:

```json
{
  "five_hour": { "utilization": 64, "resets_at": "2026-04-01T09:00:00Z" },
  "seven_day": { "utilization": 2, "resets_at": "2026-04-08T07:00:00Z" },
  "seven_day_sonnet": { "utilization": 0, "resets_at": "2026-04-02T02:00:00Z" }
}
```

The tier is determined by whichever limit is closer to its threshold — if your 5-hour window is at 95% but weekly is only at 10%, you'll still get SURVIVAL until the 5-hour window resets.

## Output

Each session start appends a row to `usage-log.csv`:

```
timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,tier
```

## Requirements

- Claude Code with OAuth login (Max or Pro plan)
- Node.js (bundled with Claude Code)

## License

MIT

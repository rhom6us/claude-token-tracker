# claude-token-tracker

A session-start hook for [Claude Code](https://claude.com/claude-code) that tracks weekly token consumption across all projects and dynamically adjusts efficiency behavior to stay within budget.

## Problem

Claude Code (Max plan) has weekly token limits, but there's no built-in way to track cumulative usage across sessions or automatically throttle behavior as you approach the limit.

## Solution

A Node.js script that runs as a Claude Code `SessionStart` hook:

1. Reads token usage data from Claude Code's session JSONL files (`~/.claude/projects/`)
2. Calculates weighted weekly consumption with configurable token weights
3. Projects weekly burn rate based on days elapsed
4. Injects an efficiency tier (`NORMAL`, `CONSERVATIVE`, or `SURVIVAL`) into the session context
5. Logs usage to CSV for historical tracking

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

### 3. Define tier behaviors in your CLAUDE.md

Add to `~/.claude/CLAUDE.md`:

```markdown
### Token Budget Tiers
A session-start hook injects a `TOKEN BUDGET` status and `EFFICIENCY TIER` at the start of each session. Follow the tier injected:

- **NORMAL** — Standard efficiency. Use best tools for the job.
- **CONSERVATIVE** — Prefer Sonnet subagents. Shorter responses. No insights unless asked. Minimize speculative exploration.
- **SURVIVAL** — Haiku subagents. Bare minimum output. No insights. No speculative reads. Ask before multi-step exploration.
```

### 4. Calibrate

The default weekly budget is 5M weighted tokens. After a week of use, check `usage-log.csv` and adjust `weeklyBudgetTokens` in `config.json` to match your actual plan limits.

## Configuration

`config.json`:

| Field | Description | Default |
|-------|-------------|---------|
| `weeklyBudgetTokens` | Weekly token budget (weighted) | `5000000` |
| `weekStartDay` | Day the week resets | `"monday"` |
| `tokenWeights.input` | Weight for input tokens | `1.0` |
| `tokenWeights.output` | Weight for output tokens | `1.0` |
| `tokenWeights.cacheCreation` | Weight for cache creation tokens | `1.0` |
| `tokenWeights.cacheRead` | Weight for cache read tokens | `0.1` |
| `tiers.normal.maxPercentUsed` | Max actual % for NORMAL tier | `50` |
| `tiers.normal.maxPercentProjected` | Max projected % for NORMAL | `70` |
| `tiers.conservative.maxPercentUsed` | Max actual % for CONSERVATIVE | `80` |
| `tiers.conservative.maxPercentProjected` | Max projected % for CONSERVATIVE | `110` |
| `claudeDir` | Override `~/.claude` path | `null` (auto-detect) |

## How it works

Claude Code stores session transcripts as JSONL files in `~/.claude/projects/<project>/<session>.jsonl`. Each API response includes a `message.usage` object with token counts. The script:

- Scans all project directories for JSONL files
- Filters entries to the current week by timestamp
- Only counts final API responses (identified by `message.usage.iterations` field) to avoid double-counting streaming partials
- Applies configurable weights — cache reads are weighted at 0.1x by default since Anthropic discounts them ~90%
- Uses the worse of actual-% and projected-% to determine tier (conservative by design)

## Output

Each session start appends a row to `usage-log.csv`:

```
timestamp,weighted_tokens,percent_used,projected_percent,tier,days_elapsed,sessions,api_calls,raw_input,raw_output,raw_cache_create,raw_cache_read
```

## License

MIT

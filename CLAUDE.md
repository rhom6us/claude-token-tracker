# claude-token-tracker

Session-start hook for Claude Code that fetches real usage data from Anthropic's API and dynamically adjusts efficiency behavior.

## Architecture
- `token-tracker.js` — Main script. Calls `GET https://api.anthropic.com/api/oauth/usage` using the OAuth token from `~/.claude/.credentials.json`, outputs hook JSON with efficiency tier.
- `config.json` — Configurable tier thresholds.
- `usage-log.csv` — Append-only log written each session start for historical tracking.

## How It Works
1. Registered as a `SessionStart` hook in `~/.claude/settings.json`
2. On session start, reads OAuth token from `~/.claude/.credentials.json`
3. Calls Anthropic's usage API to get real utilization percentages (weekly + 5-hour window)
4. Determines efficiency tier based on both weekly and 5-hour utilization
5. Outputs `additionalContext` via hook JSON — Claude Code injects this into the session context

## Tier Definitions
Tier behavior is defined in `~/.claude/CLAUDE.md` under "Token Budget Tiers":
- **NORMAL** — Standard efficiency
- **CONSERVATIVE** — Prefer Sonnet subagents, shorter responses, no insights unless asked
- **SURVIVAL** — Haiku subagents, bare minimum output, ask before multi-step exploration

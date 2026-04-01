# claude-token-tracker

Session-start hook for Claude Code that tracks weekly token consumption and dynamically adjusts efficiency behavior.

## Architecture
- `token-tracker.js` — Main script. Reads session JSONL files from `~/.claude/projects/`, calculates weekly usage, outputs hook JSON with efficiency tier.
- `config.json` — User-configurable budget, weights, and tier thresholds.
- `usage-log.csv` — Append-only log written each session start. Used for historical tracking and calibration.

## How It Works
1. Registered as a `SessionStart` hook in `~/.claude/settings.json`
2. On session start, scans all `~/.claude/projects/*/*.jsonl` files for the current week
3. Only counts final API responses (entries with `message.usage.iterations` field) to avoid double-counting streaming partials
4. Applies configurable token weights (cache reads default to 0.1x since Anthropic discounts them ~90%)
5. Determines efficiency tier based on both actual % used and projected weekly burn rate
6. Outputs `additionalContext` via hook JSON — Claude Code injects this into the session context

## Tier Definitions
Tier behavior is defined in `~/.claude/CLAUDE.md` under "Token Budget Tiers":
- **NORMAL** — Standard efficiency
- **CONSERVATIVE** — Prefer Sonnet subagents, shorter responses, no insights unless asked
- **SURVIVAL** — Haiku subagents, bare minimum output, ask before multi-step exploration

## Calibration
The default `weeklyBudgetTokens` (5M) is a starting estimate. After a week of use, review `usage-log.csv` and adjust to match your actual plan limits.

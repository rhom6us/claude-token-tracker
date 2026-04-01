---
name: burndown
description: Show a burndown chart of token usage over time from the token-tracker log
allowed-tools: [Read, Bash]
---

Read the token-tracker usage log at `~/.claude/token-tracker/usage-log.csv` (on Windows: `%USERPROFILE%\.claude\token-tracker\usage-log.csv`).

If the file doesn't exist or is empty (only headers), tell the user there's no data yet — usage gets logged each time a session starts.

If there is data, render a burndown visualization:

1. Parse the CSV. Columns: `timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,tier`

2. Show a summary table of the last 10 entries:
```
Time              │ Weekly │ 5-Hour │ Tier
──────────────────┼────────┼────────┼──────────────
Apr 01 08:30      │    2%  │   64%  │ NORMAL
Apr 01 10:15      │    5%  │   12%  │ NORMAL
...
```

3. Draw an ASCII bar chart of weekly usage over time. Use block characters (█▓▒░) to visualize the percentage. Mark tier boundaries with dashed lines:

```
Weekly Usage Burndown
100% ┤
 80% ┤╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ SURVIVAL
     │
 50% ┤╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ CONSERVATIVE
     │  █
     │  █  █
     │  █  █  █     █
  0% ┤──█──█──█──█──█──█──█──█──█──█──
       8a 10a 12p  2p  4p  6p  8p 10p
```

4. If the data spans multiple days, group by day and show daily trends.

5. End with a one-line status: current tier, weekly %, and when the weekly limit resets (if the most recent entry has that data — it doesn't, so just show what's available).

$ARGUMENTS can optionally be a number of entries to show (default: all). Example: `/burndown 20` shows last 20 entries.

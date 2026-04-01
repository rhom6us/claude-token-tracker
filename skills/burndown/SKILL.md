---
name: burndown
description: Show a burndown chart of token usage over time from the token-tracker log
allowed-tools: [Read, Bash]
---

Read the token-tracker usage log at `~/.claude/token-tracker/usage-log.csv` (on Windows: `%USERPROFILE%\.claude\token-tracker\usage-log.csv`).

If the file doesn't exist or is empty (only headers), tell the user there's no data yet — usage gets logged each time a session starts.

If there is data, render a burndown visualization:

1. Parse the CSV. Columns: `timestamp,five_hour_pct,weekly_pct,weekly_sonnet_pct,weekly_opus_pct,week_progress_pct,tier`

2. Show a summary table of the last 10 entries:
```
Time              │ Weekly │ 5-Hour │ Week %  │ Pace  │ Tier
──────────────────┼────────┼────────┼─────────┼───────┼──────────────
Apr 01 08:30      │    2%  │   64%  │   12%   │ 0.17  │ NORMAL
Apr 01 10:15      │    5%  │   12%  │   14%   │ 0.36  │ NORMAL
...
```
Where "Pace" = weekly_pct / week_progress_pct (the burn ratio).

3. Draw an ASCII **line graph** showing **actual weekly usage vs ideal pace** over time. The X-axis is week progress (0–100%), the Y-axis is token usage (0–100%). Plot two lines:

   - **Ideal pace** — a diagonal line from (0%, 0%) to (100%, 100%). This is the "budget line" — if you're on this line, you'll use exactly 100% by the end of the week.
   - **Actual usage** — plot each data point's (week_progress_pct, weekly_pct) as a connected line.

Use different characters for each line: `·` or `─` for ideal pace, `█` or `●` for actual usage. Example:

```
Token Usage vs Ideal Pace
100% ┤                                              ·
     │                                           ·
 80% ┤                                        ·
     │                                     ·
 60% ┤                                  ·
     │                       ●────●  ·
 40% ┤                   ●       ·
     │              ●         ·
 20% ┤         ●           ·
     │    ●             ·
  0% ┤●───────────────·──────────────────────────────
     0%       20%       40%       60%       80%     100%
              ← Week Progress →
     ● Actual usage    · Ideal pace
```

If the actual line is above the ideal line, you're burning faster than time is passing. Below = under budget.

4. If the data spans multiple weekly reset cycles, separate them and show the current week only (or the most recent week with data).

5. End with a one-line status showing: current tier, weekly %, week progress %, burn ratio, and a plain-English pacing assessment (e.g., "well under budget", "on pace", "ahead of pace", "significantly ahead of pace").

$ARGUMENTS can optionally be a number of entries to show (default: all). Example: `/burndown 20` shows last 20 entries.

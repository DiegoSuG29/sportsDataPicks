# Picks Dashboard: project brief

Data-driven NFL (later NBA) picks dashboard. GitHub Actions pulls open data, computes situational splits and flags edges, then commits JSON. GitHub Pages serves a static dashboard that reads that JSON. No betting sites or picks articles are used as inputs. All judgments come from data.

## Analysis rules (from the owner's NFL Picks methodology)
- Use official league data, official stats pages and reliable outlets only. Never invent numbers. Every trend needs stat backup.
- Reference window: **last season + current season only.** Don't go back further.
- Match the most situational splits possible: divisional vs. non-divisional, home/away, opponents with a similar defensive profile/coverage.
- Player props: give stats for every player listed, even if the data is incomplete. Always flag games missed to injury.
- Game with no extra context: general statistical outlook (team form, defense allowed by position, target/carry share) plus possible prop and side angles.

## Architecture
```
repo (public → Actions + Pages free)
├── nfl/pipeline.py        # nflreadpy → per-game JSON
├── nba/pipeline.py        # sportsdataverse → per-game JSON (phase 2)
├── data/nfl/week_XX/*.json, data/nba/YYYY-MM-DD/*.json
├── docs/ or site/         # static dashboard (GitHub Pages)
└── .github/workflows/
    ├── nfl.yml            # cron Wed + Sat, plus workflow_dispatch (manual "Refresh")
    └── nba.yml            # cron daily, plus workflow_dispatch
```
- Pages can't fetch nflverse directly. GitHub release downloads send no CORS headers (verified), so all fetching happens in Actions.
- Scheduled workflows in public repos pause after 60 days without activity. The data commits on each run keep them active.
- No Anthropic API key in the page. Written analysis is done by asking Claude in chat, pointed at the repo's JSON.

## Data sources (tested 2026-11-17)
NFL via `nflreadpy`:
| Dataset | Status |
|---|---|
| load_schedules(2026) | full season, includes spread_line/total_line (positive spread = home favored) |
| load_pbp(2025, 2026) | 2026 through Week 10 |
| load_player_stats(2026) | through Week 10 (targets, target_share, yards, TDs…) |
| load_snap_counts(2026) | through Week 10 |
| load_injuries(2026) | report_status (Out/Doubtful/Questionable), practice_status, injury. Through Week 10. Check on Wednesday how fast the current week's report appears |
| load_nextgen_stats | ok |
| load_participation | **2016–2025 only.** Coverage (defense_coverage_type, man/zone) unavailable for 2026. Use 2025 coverage + 2026 pass defense allowed by position as a proxy |

NBA via `sportsdataverse` (`sportsdataverse.nba.load_nba_player_boxscore`): season 2027 (= 2026-27) current through the previous day. Has `did_not_play`, `reason`, `starter`. No pregame injury report (that comes from the web at analysis time).

## Dashboard features (MVP)
1. Week's game list, then a game view: team form, defense allowed by position, target/carry/snap shares, injuries, flagged edges.
2. Prop checker: user types player + line, gets hit rate over game logs split by situation (runs in browser JS on the stored logs).
3. "With/without" splits: player usage when key teammates are out.
4. A link to each workflow's "Run workflow" page as the Refresh button.
5. Data timestamp shown on the page.

## Not available
- No odds/props feed. The user enters prop lines; spreads/totals come from nflverse.
- Breaking injury news (game-time decisions) comes from the web at analysis time.

## Build order
1. Create or connect the GitHub repo (public), enable Pages.
2. NFL pipeline, tested on Week 11 (IND @ HOU, Thu Nov 19, 2026).
3. NFL workflow (cron + manual).
4. Dashboard + prop checker.
5. NBA pipeline + workflow + sport toggle.

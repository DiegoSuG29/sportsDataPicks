"""NFL picks pipeline.

Pulls nflverse open data via nflreadpy, computes situational splits, usage
shares, defense-allowed-by-position, injuries and rule-based edge flags, then
writes one JSON file per game to ``data/nfl/week_XX/`` plus an ``index.json``.

Methodology (from the owner's NFL Picks rules):
  * Official league data only. Every trend has stat backup.
  * Reference window is **last season + current season only**.
  * Match situational splits: home/away, divisional vs non-divisional.
  * Player props: give stats for every listed player; flag games missed to injury.

Usage:
    python nfl/pipeline.py --season 2026 --week 11
    python nfl/pipeline.py                      # current season, auto-detect week

The GitHub Pages dashboard reads the JSON; no analysis lives here beyond
transparent, data-backed flags.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

import nflreadpy as nfl
import polars as pl

REPO_ROOT = Path(__file__).resolve().parent.parent
# GitHub Pages serves this repo from its root, so data/nfl/ sits next to the
# dashboard and is fetched same-origin (no CORS, no raw.githubusercontent).
OUT_ROOT = REPO_ROOT / "data" / "nfl"

SKILL_POSITIONS = ("QB", "RB", "WR", "TE", "FB")
# Buckets used for defense-allowed-by-position (FB folded into RB).
POS_BUCKET = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
BUCKETS = ("QB", "RB", "WR", "TE")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _round(x, n=2):
    """JSON-safe rounding: None/NaN -> None."""
    if x is None:
        return None
    try:
        fx = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(fx) or math.isinf(fx):
        return None
    return round(fx, n)


def _norm_name(name: str) -> str:
    """Normalize a player name for joining across sources."""
    if not name:
        return ""
    out = name.strip().lower()
    for suf in (" jr.", " sr.", " iii", " ii", " iv", " jr", " sr"):
        if out.endswith(suf):
            out = out[: -len(suf)]
    return out.replace(".", "").replace("'", "").replace("-", " ").strip()


def detect_current_week(schedules: pl.DataFrame, season: int) -> int:
    """First week of the season that still has an unplayed game, else max week."""
    s = schedules.filter(pl.col("season") == season)
    unplayed = s.filter(pl.col("home_score").is_null())
    if unplayed.height:
        return int(unplayed.select(pl.col("week").min()).item())
    return int(s.select(pl.col("week").max()).item())


# --------------------------------------------------------------------------- #
# Team-level computations
# --------------------------------------------------------------------------- #
def team_form(schedules: pl.DataFrame, team: str, season: int, upto_week: int) -> dict:
    """Recent results and record over the reference window for ``team``."""
    played = schedules.filter(
        pl.col("home_score").is_not_null()
        & ((pl.col("home_team") == team) | (pl.col("away_team") == team))
    ).sort(["season", "week"])

    games = []
    for r in played.iter_rows(named=True):
        home = r["home_team"] == team
        pf = r["home_score"] if home else r["away_score"]
        pa = r["away_score"] if home else r["home_score"]
        games.append(
            {
                "season": r["season"],
                "week": r["week"],
                "opponent": r["away_team"] if home else r["home_team"],
                "home": home,
                "div_game": bool(r["div_game"]),
                "pf": int(pf),
                "pa": int(pa),
                "result": "W" if pf > pa else ("L" if pf < pa else "T"),
            }
        )

    cur = [g for g in games if g["season"] == season and g["week"] < upto_week]
    wins = sum(g["result"] == "W" for g in cur)
    losses = sum(g["result"] == "L" for g in cur)
    ties = sum(g["result"] == "T" for g in cur)
    last5 = games[-5:]
    return {
        "record": f"{wins}-{losses}" + (f"-{ties}" if ties else ""),
        "season_games": len(cur),
        "ppg": _round(sum(g["pf"] for g in cur) / len(cur), 1) if cur else None,
        "papg": _round(sum(g["pa"] for g in cur) / len(cur), 1) if cur else None,
        "last5": [f"{g['result']} {g['pf']}-{g['pa']} vs {g['opponent']}" for g in last5],
        "home_away_split": _points_split(cur, "home"),
        "div_split": _points_split(cur, "div_game"),
    }


def _points_split(games: list[dict], key: str) -> dict:
    """Points for/against split by a boolean game attribute (home / div_game)."""
    out = {}
    for label, want in (("yes", True), ("no", False)):
        sub = [g for g in games if bool(g[key]) == want]
        name = {"home": {"yes": "home", "no": "away"},
                "div_game": {"yes": "divisional", "no": "non_divisional"}}[key][label]
        out[name] = {
            "games": len(sub),
            "ppg": _round(sum(g["pf"] for g in sub) / len(sub), 1) if sub else None,
            "papg": _round(sum(g["pa"] for g in sub) / len(sub), 1) if sub else None,
        }
    return out


def defense_allowed_table(player_stats: pl.DataFrame, season: int) -> pl.DataFrame:
    """Per-defense, per-position fantasy & yards allowed per game (current season).

    Aggregates offensive production charged to the ``opponent_team`` (the defense),
    then averages per team-game played.
    """
    df = player_stats.filter(
        (pl.col("season") == season) & pl.col("position").is_in(list(POS_BUCKET))
    ).with_columns(
        pl.col("position").replace(POS_BUCKET).alias("bucket"),
        (pl.col("receiving_yards").fill_null(0) + pl.col("rushing_yards").fill_null(0)
         + pl.col("passing_yards").fill_null(0)).alias("tot_yards"),
        (pl.col("receiving_tds").fill_null(0) + pl.col("rushing_tds").fill_null(0)
         + pl.col("passing_tds").fill_null(0)).alias("tot_tds"),
    )
    # games each defense has played = distinct (week) rows it appears as opponent
    games_played = df.group_by("opponent_team").agg(
        pl.col("week").n_unique().alias("def_games")
    )
    agg = df.group_by(["opponent_team", "bucket"]).agg(
        pl.col("fantasy_points_ppr").fill_null(0).sum().alias("fp_sum"),
        pl.col("tot_yards").sum().alias("yds_sum"),
        pl.col("tot_tds").sum().alias("tds_sum"),
    ).join(games_played, on="opponent_team", how="left")
    return agg.with_columns(
        (pl.col("fp_sum") / pl.col("def_games")).alias("fp_pg"),
        (pl.col("yds_sum") / pl.col("def_games")).alias("yds_pg"),
        (pl.col("tds_sum") / pl.col("def_games")).alias("tds_pg"),
    )


def defense_profile(def_table: pl.DataFrame, team: str) -> dict:
    """What ``team``'s defense allows by position, with league rank (1 = allows most)."""
    out = {}
    for bucket in BUCKETS:
        sub = def_table.filter(pl.col("bucket") == bucket)
        if not sub.height:
            continue
        ranked = sub.sort("fp_pg", descending=True).with_row_index("rk", offset=1)
        row = ranked.filter(pl.col("opponent_team") == team)
        if not row.height:
            continue
        r = row.row(0, named=True)
        out[bucket] = {
            "fantasy_pg_allowed": _round(r["fp_pg"], 1),
            "yards_pg_allowed": _round(r["yds_pg"], 1),
            "tds_pg_allowed": _round(r["tds_pg"], 2),
            "rank_most_allowed": int(r["rk"]),
            "of_teams": int(ranked.height),
        }
    return out


def worst_defenses(def_table: pl.DataFrame, team_opp: dict, top_n: int = 5) -> dict:
    """Top-N defenses allowing the most per position, limited to teams playing
    this week and annotated with the offense that gets to attack them."""
    out = {}
    for bucket in BUCKETS:
        sub = def_table.filter(pl.col("bucket") == bucket)
        if not sub.height:
            continue
        ranked = sub.sort("fp_pg", descending=True).with_row_index("rk", offset=1)
        rows = []
        for r in ranked.iter_rows(named=True):
            opp = team_opp.get(r["opponent_team"])
            if not opp:
                continue  # team is on bye this week
            rows.append({
                "team": r["opponent_team"],
                "rank": int(r["rk"]),
                "of_teams": int(ranked.height),
                "fantasy_pg_allowed": _round(r["fp_pg"], 1),
                "yards_pg_allowed": _round(r["yds_pg"], 1),
                "tds_pg_allowed": _round(r["tds_pg"], 2),
                "opponent": opp["opponent"],
                "home": opp["home"],
                "game_file": opp["game_file"],
            })
            if len(rows) >= top_n:
                break
        out[bucket] = rows
    return out


def team_usage(player_stats: pl.DataFrame, snaps: pl.DataFrame, team: str,
               season: int, upto_week: int) -> list[dict]:
    """Per-player current-season usage for a team's skill players."""
    df = player_stats.filter(
        (pl.col("season") == season)
        & (pl.col("week") < upto_week)
        & (pl.col("team") == team)
        & pl.col("position").is_in(list(SKILL_POSITIONS))
    )
    if not df.height:
        return []

    agg = df.group_by(["player_id", "player_display_name", "position"]).agg(
        pl.len().alias("g"),
        pl.col("targets").fill_null(0).sum().alias("targets"),
        pl.col("receptions").fill_null(0).sum().alias("receptions"),
        pl.col("receiving_yards").fill_null(0).sum().alias("rec_yds"),
        pl.col("carries").fill_null(0).sum().alias("carries"),
        pl.col("rushing_yards").fill_null(0).sum().alias("rush_yds"),
        pl.col("target_share").mean().alias("target_share"),
        pl.col("passing_tds").fill_null(0).sum().alias("pass_tds"),
        pl.col("rushing_tds").fill_null(0).sum().alias("rush_tds"),
        pl.col("receiving_tds").fill_null(0).sum().alias("rec_tds"),
        pl.col("passing_yards").fill_null(0).sum().alias("pass_yds"),
        pl.col("completions").fill_null(0).sum().alias("completions"),
        pl.col("attempts").fill_null(0).sum().alias("attempts"),
        pl.col("passing_interceptions").fill_null(0).sum().alias("interceptions"),
    )

    # snap % by normalized name (snap_counts keys on display name, not gsis id)
    snap_map = {}
    if snaps is not None and snaps.height:
        sn = snaps.filter(
            (pl.col("season") == season) & (pl.col("week") < upto_week)
            & (pl.col("team") == team)
        ).group_by("player").agg(pl.col("offense_pct").mean().alias("snap_pct"))
        for r in sn.iter_rows(named=True):
            snap_map[_norm_name(r["player"])] = r["snap_pct"]

    out = []
    for r in agg.iter_rows(named=True):
        g = r["g"] or 0
        out.append(
            {
                "player_id": r["player_id"],
                "name": r["player_display_name"],
                "position": r["position"],
                "games": g,
                "snap_pct": _round(snap_map.get(_norm_name(r["player_display_name"])), 3),
                "target_share": _round(r["target_share"], 3),
                "targets_pg": _round(r["targets"] / g, 1) if g else None,
                "receptions_pg": _round(r["receptions"] / g, 1) if g else None,
                "rec_yds_pg": _round(r["rec_yds"] / g, 1) if g else None,
                "carries_pg": _round(r["carries"] / g, 1) if g else None,
                "rush_yds_pg": _round(r["rush_yds"] / g, 1) if g else None,
                "pass_yds_pg": _round(r["pass_yds"] / g, 1) if g else None,
                "pass_tds": int(r["pass_tds"]),
                "rush_tds": int(r["rush_tds"]),
                "rec_tds": int(r["rec_tds"]),
                "completions": int(r["completions"]),
                "attempts": int(r["attempts"]),
                "interceptions": int(r["interceptions"]),
            }
        )
    # sort by involvement: targets + carries
    out.sort(key=lambda p: (p["targets_pg"] or 0) + (p["carries_pg"] or 0), reverse=True)
    return out


def team_injuries(injuries: pl.DataFrame, usage: list[dict], team: str,
                  season: int, week: int, team_games: int) -> list[dict]:
    """Current-week injury report for a team, with season games missed flagged."""
    out = []
    if injuries is None or not injuries.height:
        return out
    # use the requested week's report if present, else the latest available
    wk = injuries.filter((pl.col("season") == season) & (pl.col("team") == team))
    if not wk.height:
        return out
    avail_week = week if wk.filter(pl.col("week") == week).height else int(
        wk.select(pl.col("week").max()).item()
    )
    wk = wk.filter(pl.col("week") == avail_week)

    games_by_name = {_norm_name(p["name"]): p["games"] for p in usage}
    for r in wk.iter_rows(named=True):
        status = r["report_status"]
        if not status and not r["practice_status"]:
            continue
        played = games_by_name.get(_norm_name(r["full_name"]))
        out.append(
            {
                "name": r["full_name"],
                "position": r["position"],
                "report_status": status,
                # game report's injury, else the practice report's (game
                # statuses post later in the week than practice reports)
                "injury": r["report_primary_injury"] or r["practice_primary_injury"],
                "practice_status": r["practice_status"],
                "report_week": avail_week,
                "games_missed": (team_games - played) if played is not None else None,
            }
        )
    order = {"Out": 0, "Doubtful": 1, "Questionable": 2}
    out.sort(key=lambda x: order.get(x["report_status"], 3))
    return out


# nflverse weekly-roster status → a short "special circumstance" note.
# Keyed first by status_description_abbr (most specific), then by status.
_ROSTER_ABBR_NOTES = {
    "R01": ("IR", "On injured reserve"),
    "R48": ("IR", "Injured reserve (designated to return)"),
    "R40": ("PUP", "Physically unable to perform"),
    "R04": ("DNR", "Reserve — did not report"),
    "R05": ("NFI", "Reserve — non-football injury"),
    "I01": ("INACTIVE", "Inactive"),
    "I02": ("INACTIVE", "Inactive"),
    "W03": ("RELEASED", "Released / waived"),
    "E02": ("SUSP", "Exempt / suspended"),
}
_ROSTER_STATUS_NOTES = {
    "RES": ("RESERVE", "On a reserve list"),
    "DEV": ("PRACTICE SQ", "On the practice squad"),
    "INA": ("INACTIVE", "Inactive"),
    "RET": ("RETIRED", "Retired"),
    "CUT": ("RELEASED", "Released / waived"),
    "EXE": ("SUSP", "Exempt / suspended"),
    "TRD": ("TRADED", "Recently traded"),
    "TRC": ("TRADED", "Recently traded"),
    "TRT": ("TRADED", "Recently traded"),
}


def _roster_note(status, abbr):
    """Return (code, long_note) for a non-active status, else None."""
    # ACT wins: an active player can still carry a stale game-day abbr (e.g.
    # I01 "inactive" left over from last week) — don't flag them as out.
    if status == "ACT":
        return None
    if abbr in _ROSTER_ABBR_NOTES:
        return _ROSTER_ABBR_NOTES[abbr]
    if status in _ROSTER_STATUS_NOTES:
        return _ROSTER_STATUS_NOTES[status]
    return None  # ACT / unknown → no special circumstance


def roster_info_map(rosters: pl.DataFrame, season: int, week: int) -> dict:
    """gsis_id -> {team, as_of_week, [code, note]} from the latest available week.

    ``team`` is the player's current club (used to flag trades: a player who
    appears in a team's usage but whose current club differs has moved on).
    ``code``/``note`` are present only for a non-active status (IR/PUP/…).
    """
    if rosters is None or not rosters.height:
        return {}
    r = rosters.filter(pl.col("season") == season)
    if not r.height:
        return {}
    avail = week if r.filter(pl.col("week") == week).height else int(
        r.select(pl.col("week").max()).item()
    )
    r = r.filter(pl.col("week") == avail)
    out: dict[str, dict] = {}
    for row in r.iter_rows(named=True):
        gid = row.get("gsis_id")
        if not gid:
            continue
        info = {"team": row.get("team"), "as_of_week": avail}
        note = _roster_note(row.get("status"), row.get("status_description_abbr"))
        if note:
            info["code"], info["note"] = note
        out[gid] = info
    return out


def player_logs(player_stats: pl.DataFrame, schedules: pl.DataFrame,
                player_ids: list[str], snaps: pl.DataFrame | None = None) -> dict:
    """Per-game logs (reference window) for prop-checker filtering in the browser."""
    if not player_ids:
        return {}
    df = player_stats.filter(pl.col("player_id").is_in(player_ids)).sort(["season", "week"])

    # map game_id -> (home_team, div_game) for situational tags
    meta = {r["game_id"]: (r["home_team"], bool(r["div_game"]))
            for r in schedules.iter_rows(named=True)}

    # per-game offensive snap share, keyed by (normalized name, season, week)
    snap_lookup = {}
    if snaps is not None and snaps.height:
        for r in snaps.iter_rows(named=True):
            snap_lookup[(_norm_name(r["player"]), r["season"], r["week"])] = r["offense_pct"]

    logs: dict[str, list] = {}
    for r in df.iter_rows(named=True):
        logs.setdefault(r["player_id"], []).append(_log_row(r, meta, snap_lookup))
    return logs


def _log_row(r: dict, meta: dict, snap_lookup: dict) -> dict:
    """One player-game row (shared by player logs and defense-faced logs)."""
    home_team, div = meta.get(r["game_id"], (None, None))
    is_home = (home_team == r["team"]) if home_team else None
    snap = snap_lookup.get((_norm_name(r["player_display_name"]), r["season"], r["week"]))
    return {
        "season": r["season"],
        "week": r["week"],
        "team": r["team"],
        "opponent": r["opponent_team"],
        "home": is_home,
        "div_game": div,
        "targets": int(r["targets"] or 0),
        "receptions": int(r["receptions"] or 0),
        "rec_yds": int(r["receiving_yards"] or 0),
        "rec_tds": int(r["receiving_tds"] or 0),
        "carries": int(r["carries"] or 0),
        "rush_yds": int(r["rushing_yards"] or 0),
        "rush_tds": int(r["rushing_tds"] or 0),
        "pass_yds": int(r["passing_yards"] or 0),
        "pass_tds": int(r["passing_tds"] or 0),
        "snap_pct": _round(snap, 3) if snap is not None else None,
    }


def defense_faced_logs(player_stats: pl.DataFrame, schedules: pl.DataFrame,
                       snaps: pl.DataFrame | None, team: str, season: int) -> list[dict]:
    """Every opposing skill-player game against ``team``'s defense, CURRENT season only.

    Powers the player page's "Similar players vs X" section: the browser filters
    these by position bucket and by snap% relative to the player being viewed.
    """
    df = player_stats.filter(
        (pl.col("season") == season)
        & (pl.col("opponent_team") == team)
        & pl.col("position").is_in(list(POS_BUCKET))
    ).sort(["week", "player_display_name"])
    meta = {r["game_id"]: (r["home_team"], bool(r["div_game"]))
            for r in schedules.iter_rows(named=True)}
    snap_lookup = {}
    if snaps is not None and snaps.height:
        for r in snaps.filter(pl.col("season") == season).iter_rows(named=True):
            snap_lookup[(_norm_name(r["player"]), r["season"], r["week"])] = r["offense_pct"]
    rows = []
    for r in df.iter_rows(named=True):
        row = _log_row(r, meta, snap_lookup)
        row.update({
            "player_id": r["player_id"],
            "name": r["player_display_name"],
            "position": r["position"],
            "bucket": POS_BUCKET[r["position"]],
        })
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- #
# Edges (transparent, data-backed flags)
# --------------------------------------------------------------------------- #
def _key_usage(p: dict, bucket: str) -> str:
    """A short usage descriptor for a player, by position bucket."""
    if bucket == "QB":
        return f"{p.get('pass_yds_pg') or 0:.0f} pass yds/g"
    if bucket == "RB":
        return f"{p.get('carries_pg') or 0:.1f} car/g"
    return f"{round((p.get('target_share') or 0) * 100)}% tgt share"


def _notable(p: dict, bucket: str) -> bool:
    """Whether an absence at this player's usage level is worth flagging."""
    if bucket == "QB":
        return True
    return ((p.get("snap_pct") or 0) >= 0.35
            or (p.get("target_share") or 0) >= 0.12
            or (p.get("carries_pg") or 0) >= 6)


def _has_role(p: dict) -> bool:
    """A real on-field role, to keep edge watch-lists free of zero-usage scrubs."""
    return ((p.get("snap_pct") or 0) >= 0.12
            or (p.get("target_share") or 0) >= 0.05
            or (p.get("carries_pg") or 0) >= 2
            or (p.get("pass_yds_pg") or 0) >= 50)


def flag_edges(meta: dict, teams: dict) -> list[dict]:
    edges = []
    away, home = meta["away_team"], meta["home_team"]
    spread, total = meta["spread_line"], meta["total_line"]

    # ---- game script from the betting line ----
    if spread is not None and abs(spread) >= 7:
        fav, dog = (home, away) if spread > 0 else (away, home)
        heavy = abs(spread) >= 10
        edges.append({
            "type": "line",
            "text": (f"{fav} favored by {abs(spread)}. "
                     + (f"With a lead {fav} leans run-heavy while {dog} throws to catch up "
                        f"— {dog} pass volume and RB receiving up."
                        if heavy else "Moderate favorite; game script roughly balanced.")),
            "stat": f"spread_line={spread}, total_line={total}",
        })
    if total is not None and total >= 48:
        edges.append({"type": "total",
            "text": f"High total ({total}) — shootout profile; favors pass-catcher overs and anytime-TD props.",
            "stat": f"total_line={total}"})
    elif total is not None and total <= 39:
        edges.append({"type": "total",
            "text": f"Low total ({total}) — grind profile; favors unders and lead-back carries.",
            "stat": f"total_line={total}"})

    # ---- per-position matchup vs the opposing defense ----
    for off, dfn in ((away, home), (home, away)):
        prof = teams[dfn]["defense"]
        usage = teams[off]["usage"]
        for bucket in ("QB", "RB", "WR", "TE"):
            dp = prof.get(bucket)
            if not dp:
                continue
            third = dp["of_teams"] / 3
            tier = ("soft" if dp["rank_most_allowed"] <= third
                    else "tough" if dp["rank_most_allowed"] > 2 * third else None)
            if not tier:
                continue
            grp = [p for p in usage
                   if POS_BUCKET.get(p["position"]) == bucket and not p.get("status")
                   and _has_role(p)][:3]
            if not grp:
                continue
            watch = ", ".join(f"{p['name']} ({_key_usage(p, bucket)})" for p in grp)
            edges.append({
                "type": "matchup", "tier": tier,
                "text": (f"{off} {bucket}s vs {dfn}: {tier.upper()} matchup. "
                         f"{dfn} allows the {_ordinal(dp['rank_most_allowed'])}-most to {bucket}s "
                         f"({dp['fantasy_pg_allowed']} FP/g, {dp['yards_pg_allowed']} yds/g). "
                         f"{'Target' if tier == 'soft' else 'Fade'}: {watch}."),
                "stat": f"{dfn} vs {bucket} rank {dp['rank_most_allowed']}/{dp['of_teams']}; "
                        f"{dp['tds_pg_allowed']} TD/g allowed.",
            })

    # ---- availability / usage redistribution, per position ----
    for t in (away, home):
        usage = teams[t]["usage"]
        inj_out = {_norm_name(i["name"]): i for i in teams[t]["injuries"]
                   if i["report_status"] in ("Out", "Doubtful")}
        for bucket in ("QB", "RB", "WR", "TE"):
            grp = [p for p in usage if POS_BUCKET.get(p["position"]) == bucket]
            avail = [p for p in grp
                     if not p.get("status") and _norm_name(p["name"]) not in inj_out]
            gone = []
            for p in grp:
                reason = p.get("status") or (
                    inj_out[_norm_name(p["name"])]["report_status"]
                    if _norm_name(p["name"]) in inj_out else None)
                if reason and _notable(p, bucket):
                    gone.append(f"{p['name']} ({reason})")
            if not gone:
                continue
            benef = ", ".join(p["name"] for p in avail[:2]) or "a committee"
            edges.append({
                "type": "injury",
                "text": f"{t} {bucket} room thinned — {'; '.join(gone)}. Snaps/targets funnel to {benef}.",
                "stat": "next up: " + (", ".join(
                    f"{p['name']} {_key_usage(p, bucket)}" for p in avail[:3]) or "none listed"),
            })

    return edges


def _ordinal(n: int) -> str:
    return f"{n}{'tsnrhtdd'[(n // 10 % 10 != 1) * (n % 10 < 4) * n % 10::4]}"


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def espn_logo(url: str | None) -> str | None:
    """ESPN team logo -> dark-background variant, resized to 64px by ESPN's image combiner."""
    if not url or "/teamlogos/" not in url:
        return url
    path = url[url.index("/i/teamlogos/"):].replace("/500/", "/500-dark/")
    return f"https://a.espncdn.com/combiner/i?img={path}&h=64&w=64"


def team_logos() -> dict:
    try:
        teams = nfl.load_teams()
    except Exception as e:  # pragma: no cover - source hiccup; page falls back to text
        print(f"  teams/logos unavailable: {e}")
        return {}
    return {r["team_abbr"]: espn_logo(r["team_logo_espn"]) for r in teams.iter_rows(named=True)}


def build_week(season: int, week: int) -> dict:
    seasons = [season - 1, season]
    print(f"Loading nflverse data for seasons {seasons} ...")
    schedules = nfl.load_schedules(seasons)
    player_stats = nfl.load_player_stats(seasons)
    try:
        snaps = nfl.load_snap_counts(seasons)
    except Exception as e:  # pragma: no cover - source hiccup
        print(f"  snap_counts unavailable: {e}")
        snaps = None
    try:
        injuries = nfl.load_injuries([season])
    except Exception as e:  # pragma: no cover
        print(f"  injuries unavailable: {e}")
        injuries = None
    try:
        rosters = nfl.load_rosters_weekly([season])
    except Exception as e:  # pragma: no cover
        print(f"  rosters unavailable: {e}")
        rosters = None
    roster_map = roster_info_map(rosters, season, week)

    stats_max_week = int(
        player_stats.filter(pl.col("season") == season).select(pl.col("week").max()).item()
    )
    def_table = defense_allowed_table(player_stats, season)

    games = schedules.filter((pl.col("season") == season) & (pl.col("week") == week))
    if not games.height:
        raise SystemExit(f"No games found for {season} week {week}.")

    out_dir = OUT_ROOT / f"week_{week:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # each defense -> the offense it faces this week (for the worst-defense board)
    team_opp = {}
    for gr in games.iter_rows(named=True):
        gf = f"week_{week:02d}/{gr['game_id']}.json"
        team_opp[gr["home_team"]] = {"opponent": gr["away_team"], "home": True, "game_file": gf}
        team_opp[gr["away_team"]] = {"opponent": gr["home_team"], "home": False, "game_file": gf}

    index = {
        "season": season,
        "week": week,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stats_through_week": stats_max_week,
        "reference_window": seasons,
        "logos": team_logos(),
        "worst_defenses": worst_defenses(def_table, team_opp),
        "games": [],
    }

    for gr in games.sort("gameday").iter_rows(named=True):
        away, home = gr["away_team"], gr["home_team"]
        meta = {
            "game_id": gr["game_id"],
            "season": season,
            "week": week,
            "gameday": gr["gameday"],
            "weekday": gr["weekday"],
            "gametime": gr["gametime"],
            "away_team": away,
            "home_team": home,
            "spread_line": gr["spread_line"],   # positive = home favored
            "total_line": gr["total_line"],
            "div_game": bool(gr["div_game"]),
            "roof": gr["roof"],
            "surface": gr["surface"],
        }

        teams = {}
        for t in (away, home):
            usage = team_usage(player_stats, snaps, t, season, week)
            for p in usage:  # attach any special roster circumstance (IR/PUP/traded/…)
                rs = roster_map.get(p["player_id"])
                if not rs:
                    continue
                cur = rs.get("team")
                if cur and cur != t:  # on another club now → traded/moved away
                    p["status"] = "TRADED"
                    p["status_note"] = (
                        f"No longer on {t} — now with {cur}. "
                        f"Stats shown are from their time with {t}."
                    )
                elif rs.get("code"):
                    p["status"] = rs["code"]
                    p["status_note"] = rs["note"]
            form = team_form(schedules, t, season, week)
            teams[t] = {
                "form": form,
                "defense": defense_profile(def_table, t),
                "usage": usage,
                "injuries": team_injuries(
                    injuries, usage, t, season, week, form["season_games"]
                ),
                # opposing skill players' games vs this defense (this season)
                "faced": defense_faced_logs(player_stats, schedules, snaps, t, season),
            }

        # player logs for every listed skill player, both teams (prop checker)
        pids = [p["player_id"] for t in (away, home) for p in teams[t]["usage"]]
        logs = player_logs(player_stats, schedules, pids, snaps)

        game = {
            **meta,
            "teams": teams,
            "player_logs": logs,
            "edges": flag_edges(meta, teams),
        }

        path = out_dir / f"{gr['game_id']}.json"
        path.write_text(json.dumps(game, separators=(",", ":")), encoding="utf-8")
        print(f"  wrote {path.relative_to(REPO_ROOT)}  "
              f"({len(teams[away]['usage'])}+{len(teams[home]['usage'])} players, "
              f"{len(game['edges'])} edges)")
        index["games"].append({
            "game_id": gr["game_id"],
            "away_team": away,
            "home_team": home,
            "gameday": gr["gameday"],
            "weekday": gr["weekday"],
            "spread_line": gr["spread_line"],
            "total_line": gr["total_line"],
            "file": f"week_{week:02d}/{gr['game_id']}.json",
        })

    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {(out_dir / 'index.json').relative_to(REPO_ROOT)}")

    write_manifest()
    return index


def write_manifest() -> None:
    """Rebuild data/nfl/manifest.json from the week_* dirs the dashboard reads."""
    weeks = []
    for d in sorted(OUT_ROOT.glob("week_*")):
        idx_path = d / "index.json"
        if not idx_path.exists():
            continue
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        weeks.append({
            "season": idx["season"],
            "week": idx["week"],
            "label": f"Week {idx['week']}",
            "file": f"{d.name}/index.json",
            "games": len(idx.get("games", [])),
            "generated_at": idx.get("generated_at"),
            "stats_through_week": idx.get("stats_through_week"),
        })
    weeks.sort(key=lambda w: (w["season"], w["week"]))
    manifest = {
        "sport": "nfl",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "latest": weeks[-1] if weeks else None,
        "weeks": weeks,
    }
    (OUT_ROOT / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
    )
    print(f"  wrote {(OUT_ROOT / 'manifest.json').relative_to(REPO_ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="Build NFL per-game picks JSON.")
    ap.add_argument("--season", type=int, default=None)
    ap.add_argument("--week", type=int, default=None)
    args = ap.parse_args()

    season = args.season or _default_season()
    if args.week is None:
        week = detect_current_week(nfl.load_schedules([season]), season)
        print(f"Auto-detected current week: {week}")
    else:
        week = args.week

    index = build_week(season, week)
    print(f"\nDone: {season} week {week}, {len(index['games'])} games.")


def _default_season() -> int:
    today = dt.date.today()
    # NFL season spans Sep -> Feb; attribute Jan/Feb to the prior starting year.
    return today.year if today.month >= 3 else today.year - 1


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""NBA pipeline: sportsdataverse (ESPN) -> per-date, per-game JSON for the dashboard.

Mirrors nfl/pipeline.py. For a target date (a "slate"), it lists that day's games
and, for each team, computes season-to-date form, defense-allowed-by-position
(G/F/C), player usage, recent DNPs, per-game logs for the prop checker, and
rule-based edges. Output lands under data/nba/YYYY-MM-DD/.

Reference window: last season + current only. There is no pregame injury feed —
availability uses previous-games DNPs; the dashboard's with/without toggle lets
the user adjust for injury reports read elsewhere.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import certifi
# Keep local (Windows) runs from failing on SSL cert verification; harmless on CI.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import polars as pl
from sportsdataverse import nba

ET = ZoneInfo("America/New_York")
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "data" / "nba"
POS = ("G", "F", "C")
POS_NAME = {"G": "Guards", "F": "Forwards", "C": "Centers"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _round(x, n=1):
    return None if x is None else round(float(x), n)


def _df(obj):
    """Normalize a sportsdataverse return (polars or pandas) to a polars frame."""
    if isinstance(obj, pl.DataFrame):
        return obj
    return pl.from_pandas(obj)


def espn_logo(url: str | None) -> str | None:
    """ESPN team logo -> dark-background variant, resized to 64px by ESPN's image combiner."""
    if not url or "/teamlogos/" not in url:
        return url
    path = url[url.index("/i/teamlogos/"):].replace("/500/", "/500-dark/")
    return f"https://a.espncdn.com/combiner/i?img={path}&h=64&w=64"


def team_logos(box: pl.DataFrame) -> dict:
    df = box.select(["team_abbreviation", "team_logo"]).drop_nulls().unique(subset=["team_abbreviation"])
    return {r["team_abbreviation"]: espn_logo(r["team_logo"]) for r in df.iter_rows(named=True)}


def _default_season(today: dt.date) -> int:
    """NBA season ending year: Nov 2026 -> 2027 (the 2026-27 season)."""
    return today.year + 1 if today.month >= 9 else today.year


def _et_dt(iso: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)


def _et_date(iso: str) -> dt.date:
    return _et_dt(iso).date()


def _et_time(iso: str) -> str:
    return _et_dt(iso).strftime("%I:%M %p").lstrip("0") + " ET"


def _ordinal(n: int) -> str:
    return f"{n}{'tsnrhtdd'[(n // 10 % 10 != 1) * (n % 10 < 4) * n % 10::4]}"


def _with_fantasy(df: pl.DataFrame) -> pl.DataFrame:
    """Add a DraftKings-style fantasy column, used only to rank defense-allowed."""
    z = lambda c: pl.col(c).fill_null(0)
    return df.with_columns(
        (z("points") + 1.25 * z("rebounds") + 1.5 * z("assists") + 2 * z("steals")
         + 2 * z("blocks") - 0.5 * z("turnovers")
         + 0.5 * z("three_point_field_goals_made")).alias("fp")
    )


# --------------------------------------------------------------------------- #
# Team form
# --------------------------------------------------------------------------- #
def _team_games(cur: pl.DataFrame, team: str) -> pl.DataFrame:
    """One row per game for a team (box rows repeat team-level fields per player)."""
    return (
        cur.filter(pl.col("team_abbreviation") == team)
        .unique(subset=["game_id"], keep="first")
        .select(["game_id", "game_date", "home_away", "team_score",
                 "opponent_team_score", "opponent_team_abbreviation", "team_winner"])
        .sort("game_date")
    )


def _points_split(rows: list[dict]) -> dict:
    if not rows:
        return {"games": 0, "ppg": None, "papg": None}
    n = len(rows)
    return {
        "games": n,
        "ppg": _round(sum(r["team_score"] for r in rows) / n),
        "papg": _round(sum(r["opponent_team_score"] for r in rows) / n),
    }


def team_form(cur: pl.DataFrame, team: str, slate: dt.date, gposs: pl.DataFrame) -> dict:
    tgf = _team_games(cur, team)
    tg = tgf.to_dicts()
    pace = tgf.join(gposs, on="game_id", how="left")["game_poss"].mean() if tg else None
    wins = sum(1 for r in tg if r["team_winner"])
    rows_home = [r for r in tg if r["home_away"] == "home"]
    rows_away = [r for r in tg if r["home_away"] == "away"]
    last5 = []
    for r in reversed(tg[-5:]):  # most recent first
        res = "W" if r["team_winner"] else "L"
        vs = "vs" if r["home_away"] == "home" else "@"
        last5.append(f"{res} {r['team_score']}-{r['opponent_team_score']} {vs} {r['opponent_team_abbreviation']}")
    last_date = tg[-1]["game_date"] if tg else None
    rest = (slate - last_date).days if last_date else None
    return {
        "record": f"{wins}-{len(tg) - wins}",
        "season_games": len(tg),
        "ppg": _points_split(tg)["ppg"],
        "papg": _points_split(tg)["papg"],
        "pace": _round(pace),
        "rest_days": rest,
        "back_to_back": rest == 1 if rest is not None else False,
        "last5": last5,
        "home_away_split": {"home": _points_split(rows_home), "away": _points_split(rows_away)},
    }


# --------------------------------------------------------------------------- #
# Defense allowed by position (G/F/C) — league ranked
# --------------------------------------------------------------------------- #
# Per-stat matchup ranks. "fp" = overall (fantasy) rank, the others are the
# individual props. All ranks are pace-adjusted (allowed per 100 possessions),
# so a defense isn't "soft" just because its games are fast.
DEF_STATS = {"fp": "fp", "pts": "points", "reb": "rebounds", "ast": "assists",
             "fg3m": "three_point_field_goals_made"}
STAT_LABEL = {"fp": "FP", "pts": "PTS", "reb": "REB", "ast": "AST", "fg3m": "3PM"}
STRONG_N = 5  # top/bottom-N per-stat rank = a flagged (strong) matchup


def game_possessions(cur: pl.DataFrame) -> pl.DataFrame:
    """Estimated possessions per game: mean of both teams' FGA + 0.44*FTA - OREB + TOV."""
    z = lambda c: pl.col(c).fill_null(0)
    team = cur.group_by(["game_id", "team_abbreviation"]).agg(
        (z("field_goals_attempted") + 0.44 * z("free_throws_attempted")
         - z("offensive_rebounds") + z("turnovers")).sum().alias("poss")
    )
    return team.group_by("game_id").agg(pl.col("poss").mean().alias("game_poss"))


def defense_table(cur: pl.DataFrame, gposs: pl.DataFrame) -> pl.DataFrame:
    """Per-defense, per-position production allowed (current season): per game,
    per 100 possessions, pace-adjusted rank and % vs league average, per stat."""
    df = _with_fantasy(cur).filter(pl.col("athlete_position_abbreviation").is_in(list(POS)))
    games = (
        cur.select(["game_id", "opponent_team_abbreviation"]).unique()
        .join(gposs, on="game_id", how="left")
        .group_by("opponent_team_abbreviation")
        .agg(pl.col("game_id").n_unique().alias("def_games"),
             pl.col("game_poss").sum().alias("def_poss"))
    )
    agg = df.group_by(["opponent_team_abbreviation", "athlete_position_abbreviation"]).agg(
        [pl.col(col).fill_null(0).sum().alias(f"{k}_sum") for k, col in DEF_STATS.items()]
    ).join(games, on="opponent_team_abbreviation", how="left")
    pos = "athlete_position_abbreviation"
    agg = agg.with_columns(
        [(pl.col(f"{k}_sum") / pl.col("def_games")).alias(f"{k}_pg") for k in DEF_STATS]
        + [(100 * pl.col(f"{k}_sum") / pl.col("def_poss")).alias(f"{k}_p100") for k in DEF_STATS]
    )
    return agg.with_columns(
        [pl.col(f"{k}_p100").rank("min", descending=True).over(pos).cast(pl.Int64).alias(f"{k}_rk")
         for k in DEF_STATS]
        + [(pl.col(f"{k}_p100") / pl.col(f"{k}_p100").mean().over(pos) - 1).alias(f"{k}_vs")
           for k in DEF_STATS]
        + [pl.len().over(pos).alias("of_teams")]
    )


def _stat_entry(r: dict, k: str) -> dict:
    return {"pg": _round(r[f"{k}_pg"]), "p100": _round(r[f"{k}_p100"]),
            "rank": int(r[f"{k}_rk"]), "vs_avg": _round(r[f"{k}_vs"], 3)}


def defense_profile(def_table: pl.DataFrame, team: str) -> dict:
    out = {}
    for pos in POS:
        row = def_table.filter((pl.col("athlete_position_abbreviation") == pos)
                               & (pl.col("opponent_team_abbreviation") == team))
        if not row.height:
            continue
        r = row.row(0, named=True)
        out[pos] = {
            "fantasy_pg_allowed": _round(r["fp_pg"]),
            "pts_pg_allowed": _round(r["pts_pg"]),
            "reb_pg_allowed": _round(r["reb_pg"]),
            "ast_pg_allowed": _round(r["ast_pg"]),
            "fg3m_pg_allowed": _round(r["fg3m_pg"]),
            "rank_most_allowed": int(r["fp_rk"]),  # overall, pace-adjusted
            "of_teams": int(r["of_teams"]),
            "by_stat": {k: _stat_entry(r, k) for k in DEF_STATS},
        }
    return out


def worst_defenses(def_table: pl.DataFrame, team_opp: dict, stat: str = "fp",
                   top_n: int = 5) -> dict:
    """Softest defenses per position for one stat, among teams on this slate."""
    out = {}
    for pos in POS:
        sub = def_table.filter(pl.col("athlete_position_abbreviation") == pos).sort(f"{stat}_rk")
        rows = []
        for r in sub.iter_rows(named=True):
            opp = team_opp.get(r["opponent_team_abbreviation"])
            if not opp:
                continue  # team not playing this slate
            rows.append({
                "team": r["opponent_team_abbreviation"],
                "rank": int(r[f"{stat}_rk"]),
                "of_teams": int(r["of_teams"]),
                "fantasy_pg_allowed": _round(r["fp_pg"]),
                "pts_pg_allowed": _round(r["pts_pg"]),
                "pg": _round(r[f"{stat}_pg"]),
                "p100": _round(r[f"{stat}_p100"]),
                "vs_avg": _round(r[f"{stat}_vs"], 3),
                "opponent": opp["opponent"],
                "home": opp["home"],
                "game_file": opp["game_file"],
            })
            if len(rows) >= top_n:
                break
        out[pos] = rows
    return out


# --------------------------------------------------------------------------- #
# Usage, availability, logs
# --------------------------------------------------------------------------- #
def _played(df: pl.DataFrame) -> pl.DataFrame:
    return df.filter((~pl.col("did_not_play")) & (pl.col("minutes") > 0))


def team_usage(cur: pl.DataFrame, team: str) -> list[dict]:
    df = _played(cur.filter(pl.col("team_abbreviation") == team))
    if not df.height:
        return []
    agg = df.group_by(["athlete_id", "athlete_display_name"]).agg(
        pl.col("athlete_position_abbreviation").mode().first().alias("position"),
        pl.len().alias("g"),
        pl.col("minutes").mean().alias("min"),
        pl.col("points").mean().alias("pts"),
        pl.col("rebounds").mean().alias("reb"),
        pl.col("assists").mean().alias("ast"),
        pl.col("three_point_field_goals_made").mean().alias("fg3m"),
        pl.col("field_goals_made").sum().alias("fgm"),
        pl.col("field_goals_attempted").sum().alias("fga"),
        pl.col("steals").mean().alias("stl"),
        pl.col("blocks").mean().alias("blk"),
        pl.col("turnovers").mean().alias("to"),
        pl.col("starter").mean().alias("starter_rate"),
    )
    out = []
    for r in agg.iter_rows(named=True):
        out.append({
            "player_id": str(r["athlete_id"]),
            "name": r["athlete_display_name"],
            "position": r["position"],
            "games": int(r["g"]),
            "min_pg": _round(r["min"]),
            "pts_pg": _round(r["pts"]),
            "reb_pg": _round(r["reb"]),
            "ast_pg": _round(r["ast"]),
            "fg3m_pg": _round(r["fg3m"]),
            "fg_pct": _round(r["fgm"] / r["fga"], 3) if r["fga"] else None,
            "fga_pg": _round(r["fga"] / r["g"]) if r["g"] else None,
            "stl_pg": _round(r["stl"]),
            "blk_pg": _round(r["blk"]),
            "to_pg": _round(r["to"]),
            "starter_rate": _round(r["starter_rate"], 2),
        })
    out.sort(key=lambda p: p["min_pg"] or 0, reverse=True)
    return out


def recent_dnps(cur: pl.DataFrame, team: str, lookback: int = 5) -> list[dict]:
    """Players who sat in the team's recent games (no pregame injury feed)."""
    tg = _team_games(cur, team)
    if not tg.height:
        return []
    recent_dates = tg.sort("game_date")["game_date"].to_list()[-lookback:]
    df = cur.filter(
        (pl.col("team_abbreviation") == team)
        & pl.col("did_not_play")
        & pl.col("game_date").is_in(recent_dates)
    ).sort("game_date", descending=True)
    seen, out = set(), []
    for r in df.iter_rows(named=True):
        key = r["athlete_id"]
        if key in seen:
            # count only; already recorded most-recent reason
            for o in out:
                if o["player_id"] == str(key):
                    o["dnp_games"] += 1
            continue
        seen.add(key)
        out.append({
            "player_id": str(key),
            "name": r["athlete_display_name"],
            "position": r["athlete_position_abbreviation"],
            "reason": r["reason"] or "DNP",
            "last_dnp": r["game_date"].isoformat(),
            "dnp_games": 1,
        })
    return out


def player_logs(box: pl.DataFrame, player_ids: list[str]) -> dict:
    """Per-game logs (reference window) for prop-checker filtering in the browser."""
    if not player_ids:
        return {}
    ids = [int(p) for p in player_ids]
    df = _played(box.filter(pl.col("athlete_id").is_in(ids))).sort(["season", "game_date"])
    logs: dict[str, list] = {}
    for r in df.iter_rows(named=True):
        logs.setdefault(str(r["athlete_id"]), []).append(_log_row(r))
    return logs


def _log_row(r: dict) -> dict:
    return {
        "season": int(r["season"]),
        "date": r["game_date"].isoformat(),
        "team": r["team_abbreviation"],
        "opponent": r["opponent_team_abbreviation"],
        "home": r["home_away"] == "home",
        "min": _round(r["minutes"]),
        "pts": int(r["points"] or 0),
        "reb": int(r["rebounds"] or 0),
        "ast": int(r["assists"] or 0),
        "fg3m": int(r["three_point_field_goals_made"] or 0),
        "stl": int(r["steals"] or 0),
        "blk": int(r["blocks"] or 0),
        "to": int(r["turnovers"] or 0),
        "started": bool(r["starter"]),
    }


def defense_faced(cur: pl.DataFrame, team: str) -> tuple[list[dict], dict]:
    """Every opposing player-game against ``team`` this season (G/F/C), plus each
    of those players' current-season averages. Powers "Similar players vs X":
    the browser filters by position, minutes and the prop stat's season average."""
    df = _played(cur.filter((pl.col("opponent_team_abbreviation") == team)
                            & pl.col("athlete_position_abbreviation").is_in(list(POS))))
    df = df.sort(["game_date", "athlete_display_name"])
    rows = []
    for r in df.iter_rows(named=True):
        row = _log_row(r)
        row.update({"player_id": str(r["athlete_id"]), "name": r["athlete_display_name"],
                    "position": r["athlete_position_abbreviation"],
                    "bucket": r["athlete_position_abbreviation"]})
        rows.append(row)
    ids = list({int(r["player_id"]) for r in rows})
    avgs = {}
    if ids:
        agg = _played(cur.filter(pl.col("athlete_id").is_in(ids))).group_by("athlete_id").agg(
            pl.len().alias("g"),
            *[pl.col(c).fill_null(0).mean().alias(k) for k, c in (
                ("min", "minutes"), ("pts", "points"), ("reb", "rebounds"), ("ast", "assists"),
                ("fg3m", "three_point_field_goals_made"), ("stl", "steals"),
                ("blk", "blocks"), ("to", "turnovers"))],
        )
        for r in agg.iter_rows(named=True):
            avgs[str(r["athlete_id"])] = {"g": int(r["g"]), **{
                k: _round(r[k], 2) for k in ("min", "pts", "reb", "ast", "fg3m", "stl", "blk", "to")}}
    return rows, avgs


# --------------------------------------------------------------------------- #
# Edges
# --------------------------------------------------------------------------- #
def _usage_tag(p: dict) -> str:
    return f"{p['pts_pg']} pts, {p['min_pg']} min"


def flag_edges(meta: dict, teams: dict) -> list[dict]:
    edges = []
    away, home = meta["away_team"], meta["home_team"]

    # rest / schedule-spot edge
    for t, opp in ((away, home), (home, away)):
        f = teams[t]["form"]
        of = teams[opp]["form"]
        if f.get("back_to_back") and (of.get("rest_days") or 0) >= 2:
            edges.append({
                "type": "line",
                "text": f"{t} on a back-to-back vs rested {opp} — fade {t} efficiency/minutes late, "
                        f"watch {opp} pace.",
                "stat": f"{t} rest={f.get('rest_days')}d, {opp} rest={of.get('rest_days')}d",
            })

    # per-position, per-stat matchup vs the opposing defense (pace-adjusted ranks)
    props = [k for k in DEF_STATS if k != "fp"]
    for off, dfn in ((away, home), (home, away)):
        prof = teams[dfn]["defense"]
        usage = teams[off]["usage"]
        for pos in POS:
            dp = prof.get(pos)
            if not dp:
                continue
            n = dp["of_teams"]
            grp = [p for p in usage if p["position"] == pos and (p["min_pg"] or 0) >= 18]
            if not grp:
                continue
            for tier in ("soft", "tough"):
                keys = [k for k in props
                        if (dp["by_stat"][k]["rank"] <= STRONG_N if tier == "soft"
                            else dp["by_stat"][k]["rank"] > n - STRONG_N)]
                if not keys:
                    continue
                parts, who = [], []
                for k in keys:
                    b = dp["by_stat"][k]
                    parts.append(f"{STAT_LABEL[k]} {_ordinal(b['rank'])}-most "
                                 f"({b['pg']}/g, {b['vs_avg'] * 100:+.0f}% vs avg)")
                    top = sorted(grp, key=lambda p: p.get(f"{k}_pg") or 0, reverse=True)[:2]
                    # keep the runner-up only if they're a real contributor in that stat
                    top = [p for p in top if (p.get(f"{k}_pg") or 0) >= 0.6 * (top[0].get(f"{k}_pg") or 0)]
                    who.append(f"{STAT_LABEL[k]}: " + ", ".join(
                        f"{p['name']} ({p.get(f'{k}_pg')})" for p in top))
                labels = ", ".join(STAT_LABEL[k] for k in keys)
                edges.append({
                    "type": "matchup", "tier": tier, "pos": pos, "stats": keys,
                    "text": (f"{off} {POS_NAME[pos]} vs {dfn}: {tier.upper()} for {labels}. "
                             f"{dfn} allows to {pos}s: " + "; ".join(parts) + ". "
                             f"{'Target' if tier == 'soft' else 'Fade'} — " + "; ".join(who) + "."),
                    "stat": (f"Pace-adjusted (per 100 poss) ranks of {n}; "
                             f"{'top' if tier == 'soft' else 'bottom'} {STRONG_N} flagged. "
                             f"Overall FP rank {dp['rank_most_allowed']}/{n}."),
                })

    # availability / recent DNPs
    for t in (away, home):
        dnps = [d for d in teams[t]["dnps"] if d["dnp_games"] >= 1]
        if not dnps:
            continue
        who = "; ".join(f"{d['name']} ({d['reason']})" for d in dnps[:4])
        edges.append({
            "type": "injury",
            "text": f"{t} recent DNPs — {who}. Confirm game-time status; usage shifts if they sit.",
            "stat": "based on the last 5 games (no pregame injury feed).",
        })
    return edges


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def _pick_slate(schedule: pl.DataFrame, target: dt.date | None) -> dt.date:
    dates = sorted({_et_date(r["date"]) for r in schedule.iter_rows(named=True)})
    if target:
        return target
    today = dt.datetime.now(ET).date()
    future = [d for d in dates if d >= today]
    return future[0] if future else (dates[-1] if dates else today)


def build_slate(season: int | None = None, date: dt.date | None = None) -> dict:
    today = dt.datetime.now(ET).date()
    season = season or _default_season(today)
    seasons = [season - 1, season]
    print(f"Loading NBA data for seasons {seasons} ...")
    schedule = _df(nba.load_nba_schedule(seasons=[season]))
    box = _df(nba.load_nba_player_boxscore(seasons=seasons))

    slate = _pick_slate(schedule, date)
    print(f"Slate: {slate}")

    games = [r for r in schedule.iter_rows(named=True) if _et_date(r["date"]) == slate]
    if not games:
        raise SystemExit(f"No NBA games scheduled on {slate}.")

    # current-season completed games strictly before the slate
    cur = box.filter((pl.col("season") == season) & (pl.col("game_date") < slate))
    gposs = game_possessions(cur)
    def_tbl = defense_table(cur, gposs)
    stats_through = (cur.select(pl.col("game_date").max()).item()
                     if cur.height else None)

    out_dir = OUT_ROOT / slate.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)

    team_opp = {}
    for g in games:
        gf = f"{slate.isoformat()}/{g['id']}.json"
        team_opp[g["home_abbreviation"]] = {"opponent": g["away_abbreviation"], "home": True, "game_file": gf}
        team_opp[g["away_abbreviation"]] = {"opponent": g["home_abbreviation"], "home": False, "game_file": gf}

    index = {
        "season": season,
        "date": slate.isoformat(),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stats_through": stats_through.isoformat() if stats_through else None,
        "reference_window": seasons,
        "logos": team_logos(box),
        "worst_defenses": worst_defenses(def_tbl, team_opp),
        "worst_by_stat": {k: worst_defenses(def_tbl, team_opp, k) for k in DEF_STATS},
        "games": [],
    }

    for g in sorted(games, key=lambda r: r["date"]):
        away, home = g["away_abbreviation"], g["home_abbreviation"]
        meta = {
            "game_id": str(g["id"]),
            "season": season,
            "date": slate.isoformat(),
            "tipoff": _et_time(g["date"]),
            "status": g["status_type_state"],
            "away_team": away,
            "home_team": home,
        }
        teams = {}
        for t in (away, home):
            faced, faced_avgs = defense_faced(cur, t)
            teams[t] = {
                "form": team_form(cur, t, slate, gposs),
                "defense": defense_profile(def_tbl, t),
                "usage": team_usage(cur, t),
                "dnps": recent_dnps(cur, t),
                # opposing players' games vs this defense (this season) + their averages
                "faced": faced,
                "faced_avgs": faced_avgs,
            }
        pids = [p["player_id"] for t in (away, home) for p in teams[t]["usage"]]
        logs = player_logs(box, pids)

        game = {**meta, "teams": teams, "player_logs": logs, "edges": flag_edges(meta, teams)}
        (out_dir / f"{g['id']}.json").write_text(json.dumps(game, separators=(",", ":")), encoding="utf-8")
        print(f"  wrote {away}@{home}  "
              f"({len(teams[away]['usage'])}+{len(teams[home]['usage'])} players, "
              f"{len(game['edges'])} edges)")
        index["games"].append({
            "game_id": str(g["id"]),
            "away_team": away,
            "home_team": home,
            "tipoff": _et_time(g["date"]),
            "status": g["status_type_state"],
            "file": f"{slate.isoformat()}/{g['id']}.json",
        })

    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {(out_dir / 'index.json').relative_to(REPO_ROOT)}")
    write_manifest()
    return index


def write_manifest() -> None:
    """Rebuild data/nba/manifest.json from the YYYY-MM-DD dirs the dashboard reads."""
    slates = []
    for d in sorted(OUT_ROOT.glob("20*-*-*")):
        idx_path = d / "index.json"
        if not idx_path.exists():
            continue
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        dd = dt.date.fromisoformat(idx["date"])
        slates.append({
            "season": idx["season"],
            "date": idx["date"],
            "label": dd.strftime("%a %b ") + str(dd.day),  # e.g. "Tue Nov 18"
            "file": f"{d.name}/index.json",
            "games": len(idx.get("games", [])),
            "generated_at": idx.get("generated_at"),
            "stats_through": idx.get("stats_through"),
        })
    slates.sort(key=lambda s: s["date"])
    manifest = {
        "sport": "nba",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "latest": slates[-1] if slates else None,
        "slates": slates,
    }
    (OUT_ROOT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {(OUT_ROOT / 'manifest.json').relative_to(REPO_ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="Build NBA per-game picks JSON.")
    ap.add_argument("--season", type=int, default=None, help="season ending year (2027 = 2026-27)")
    ap.add_argument("--date", type=str, default=None, help="slate date YYYY-MM-DD (default: next scheduled)")
    args = ap.parse_args()
    date = dt.date.fromisoformat(args.date) if args.date else None
    index = build_slate(args.season, date)
    print(f"\nDone: {index['date']}, {len(index['games'])} games.")


if __name__ == "__main__":
    main()

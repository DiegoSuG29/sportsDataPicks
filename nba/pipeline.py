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


def team_form(cur: pl.DataFrame, team: str, slate: dt.date) -> dict:
    tg = _team_games(cur, team).to_dicts()
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
        "rest_days": rest,
        "back_to_back": rest == 1 if rest is not None else False,
        "last5": last5,
        "home_away_split": {"home": _points_split(rows_home), "away": _points_split(rows_away)},
    }


# --------------------------------------------------------------------------- #
# Defense allowed by position (G/F/C) — league ranked
# --------------------------------------------------------------------------- #
def defense_table(cur: pl.DataFrame) -> pl.DataFrame:
    """Per-defense, per-position production allowed per game (current season)."""
    df = _with_fantasy(cur).filter(pl.col("athlete_position_abbreviation").is_in(list(POS)))
    games = df.group_by("opponent_team_abbreviation").agg(
        pl.col("game_id").n_unique().alias("def_games")
    )
    agg = df.group_by(["opponent_team_abbreviation", "athlete_position_abbreviation"]).agg(
        pl.col("fp").sum().alias("fp_sum"),
        pl.col("points").fill_null(0).sum().alias("pts_sum"),
        pl.col("rebounds").fill_null(0).sum().alias("reb_sum"),
        pl.col("assists").fill_null(0).sum().alias("ast_sum"),
    ).join(games, on="opponent_team_abbreviation", how="left")
    return agg.with_columns(
        (pl.col("fp_sum") / pl.col("def_games")).alias("fp_pg"),
        (pl.col("pts_sum") / pl.col("def_games")).alias("pts_pg"),
        (pl.col("reb_sum") / pl.col("def_games")).alias("reb_pg"),
        (pl.col("ast_sum") / pl.col("def_games")).alias("ast_pg"),
    )


def defense_profile(def_table: pl.DataFrame, team: str) -> dict:
    out = {}
    for pos in POS:
        sub = def_table.filter(pl.col("athlete_position_abbreviation") == pos)
        if not sub.height:
            continue
        ranked = sub.sort("fp_pg", descending=True).with_row_index("rk", offset=1)
        row = ranked.filter(pl.col("opponent_team_abbreviation") == team)
        if not row.height:
            continue
        r = row.row(0, named=True)
        out[pos] = {
            "fantasy_pg_allowed": _round(r["fp_pg"]),
            "pts_pg_allowed": _round(r["pts_pg"]),
            "reb_pg_allowed": _round(r["reb_pg"]),
            "ast_pg_allowed": _round(r["ast_pg"]),
            "rank_most_allowed": int(r["rk"]),
            "of_teams": int(ranked.height),
        }
    return out


def worst_defenses(def_table: pl.DataFrame, team_opp: dict, top_n: int = 5) -> dict:
    out = {}
    for pos in POS:
        sub = def_table.filter(pl.col("athlete_position_abbreviation") == pos)
        if not sub.height:
            continue
        ranked = sub.sort("fp_pg", descending=True).with_row_index("rk", offset=1)
        rows = []
        for r in ranked.iter_rows(named=True):
            opp = team_opp.get(r["opponent_team_abbreviation"])
            if not opp:
                continue  # team not playing this slate
            rows.append({
                "team": r["opponent_team_abbreviation"],
                "rank": int(r["rk"]),
                "of_teams": int(ranked.height),
                "fantasy_pg_allowed": _round(r["fp_pg"]),
                "pts_pg_allowed": _round(r["pts_pg"]),
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
        logs.setdefault(str(r["athlete_id"]), []).append({
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
        })
    return logs


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

    # per-position matchup vs the opposing defense (G/F/C)
    for off, dfn in ((away, home), (home, away)):
        prof = teams[dfn]["defense"]
        usage = teams[off]["usage"]
        for pos in POS:
            dp = prof.get(pos)
            if not dp:
                continue
            third = dp["of_teams"] / 3
            tier = ("soft" if dp["rank_most_allowed"] <= third
                    else "tough" if dp["rank_most_allowed"] > 2 * third else None)
            if not tier:
                continue
            grp = [p for p in usage if p["position"] == pos and (p["min_pg"] or 0) >= 18][:3]
            if not grp:
                continue
            watch = ", ".join(f"{p['name']} ({_usage_tag(p)})" for p in grp)
            edges.append({
                "type": "matchup", "tier": tier,
                "text": (f"{off} {POS_NAME[pos]} vs {dfn}: {tier.upper()} matchup. "
                         f"{dfn} allows the {_ordinal(dp['rank_most_allowed'])}-most to {pos}s "
                         f"({dp['fantasy_pg_allowed']} FP/g, {dp['pts_pg_allowed']} pts/g). "
                         f"{'Target' if tier == 'soft' else 'Fade'}: {watch}."),
                "stat": f"{dfn} vs {pos} rank {dp['rank_most_allowed']}/{dp['of_teams']}; "
                        f"{dp['reb_pg_allowed']} reb, {dp['ast_pg_allowed']} ast allowed.",
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
    def_tbl = defense_table(cur)
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
        "worst_defenses": worst_defenses(def_tbl, team_opp),
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
            teams[t] = {
                "form": team_form(cur, t, slate),
                "defense": defense_profile(def_tbl, t),
                "usage": team_usage(cur, t),
                "dnps": recent_dnps(cur, t),
            }
        pids = [p["player_id"] for t in (away, home) for p in teams[t]["usage"]]
        logs = player_logs(box, pids)

        game = {**meta, "teams": teams, "player_logs": logs, "edges": flag_edges(meta, teams)}
        (out_dir / f"{g['id']}.json").write_text(json.dumps(game, indent=2), encoding="utf-8")
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

    (out_dir / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
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
    (OUT_ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
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

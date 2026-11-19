// Per-sport configuration. Everything that differs between NFL and NBA lives
// here so the view components can stay shared and just read `cfg`.
import { fmt, pct, spreadText } from "./util.js";

// ---------------------------------------------------------------- NFL props
const NFL_STATS = [
  { key: "rec_yds", label: "Receiving yards", positions: ["WR", "TE", "RB"], def: 40.5, min: 10.5, max: 150.5, step: 1, dec: 1 },
  { key: "receptions", label: "Receptions", positions: ["WR", "TE", "RB"], def: 3.5, min: 0.5, max: 12.5, step: 1, dec: 0 },
  { key: "targets", label: "Targets", positions: ["WR", "TE", "RB"], def: 5.5, min: 0.5, max: 15.5, step: 1, dec: 0 },
  { key: "rush_yds", label: "Rushing yards", positions: ["RB", "QB"], def: 40.5, min: 10.5, max: 150.5, step: 1, dec: 1 },
  { key: "carries", label: "Rush attempts", positions: ["RB", "QB"], def: 10.5, min: 2.5, max: 29.5, step: 1, dec: 0 },
  { key: "scrim_yds", label: "Rush + Rec yards", positions: ["RB", "WR", "TE"], def: 60.5, min: 20.5, max: 200.5, step: 1, dec: 1, compute: (r) => r.rush_yds + r.rec_yds },
  { key: "pass_yds", label: "Passing yards", positions: ["QB"], def: 224.5, min: 149.5, max: 349.5, step: 1, dec: 1 },
  { key: "pass_tds", label: "Passing TDs", positions: ["QB"], def: 1.5, min: 0.5, max: 5.5, step: 1, dec: 0 },
  { key: "anytime_td", label: "Anytime TD", positions: ["QB", "RB", "WR", "TE"], def: 0.5, min: 0.5, max: 2.5, step: 1, dec: 0, compute: (r) => r.rush_tds + r.rec_tds },
];

// ---------------------------------------------------------------- NBA props
const NBA_STATS = [
  { key: "pts", label: "Points", positions: ["G", "F", "C"], def: 20.5, min: 2.5, max: 40.5, step: 1, dec: 0 },
  { key: "reb", label: "Rebounds", positions: ["G", "F", "C"], def: 6.5, min: 0.5, max: 15.5, step: 1, dec: 0 },
  { key: "ast", label: "Assists", positions: ["G", "F", "C"], def: 4.5, min: 0.5, max: 15.5, step: 1, dec: 0 },
  { key: "fg3m", label: "3-pointers", positions: ["G", "F", "C"], def: 2.5, min: 0.5, max: 6.5, step: 1, dec: 0 },
  { key: "pra", label: "Pts+Reb+Ast", positions: ["G", "F", "C"], def: 30.5, min: 5.5, max: 70.5, step: 1, dec: 0, compute: (r) => r.pts + r.reb + r.ast },
  { key: "pr", label: "Pts+Reb", positions: ["G", "F", "C"], def: 26.5, min: 3.5, max: 55.5, step: 1, dec: 0, compute: (r) => r.pts + r.reb },
  { key: "pa", label: "Pts+Ast", positions: ["G", "F", "C"], def: 25.5, min: 3.5, max: 55.5, step: 1, dec: 0, compute: (r) => r.pts + r.ast },
  { key: "ra", label: "Reb+Ast", positions: ["G", "F", "C"], def: 10.5, min: 1.5, max: 30.5, step: 1, dec: 0, compute: (r) => r.reb + r.ast },
  { key: "stlblk", label: "Stl+Blk", positions: ["G", "F", "C"], def: 1.5, min: 0.5, max: 8.5, step: 1, dec: 0, compute: (r) => r.stl + r.blk },
  { key: "to", label: "Turnovers", positions: ["G", "F", "C"], def: 2.5, min: 0.5, max: 8.5, step: 1, dec: 0 },
];

const netTile = (f) => {
  const net = (f.ppg ?? 0) - (f.papg ?? 0);
  return { label: "Net/g", value: `${net > 0 ? "+" : ""}${fmt(net)}`, cls: net > 0 ? "over" : net < 0 ? "under" : "" };
};

export const SPORTS = {
  nfl: {
    key: "nfl",
    label: "NFL",
    logo: "🏈",
    usageSort: (p) => p.snap_pct || 0,
    tagline: "Data-driven NFL edges — all judgments come from official data.",
    slateListKey: "weeks",
    slateSelectLabel: "Week",
    slateOptionLabel: (w) => `${w.label} (${w.season})`,
    stamp: (idx) =>
      `Season ${idx.season} · ${idx.games.length} games · stats through Week ${idx.stats_through_week} · data generated ${new Date(idx.generated_at).toLocaleString()}`,

    statOptions: NFL_STATS,
    defaultStat: (pos) => (pos === "QB" ? "pass_yds" : pos === "RB" || pos === "FB" ? "rush_yds" : "rec_yds"),
    positions: ["QB", "RB", "WR", "TE"],
    posName: { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends", FB: "Fullbacks" },
    bucket: { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" },

    usageColumns: (b) => (
      b === "QB" ? [
        ["Snap%", (p) => pct(p.snap_pct)], ["Comp%", (p) => (p.attempts ? pct(p.completions / p.attempts) : "—")],
        ["Comp/g", (p) => (p.games ? fmt(p.completions / p.games) : "—")], ["Yds/g", (p) => fmt(p.pass_yds_pg)],
        ["Pass TD", (p) => p.pass_tds], ["INT", (p) => p.interceptions],
        ["Rush att/g", (p) => fmt(p.carries_pg)], ["Rush yd/g", (p) => fmt(p.rush_yds_pg)],
      ] : b === "RB" ? [
        ["Snap%", (p) => pct(p.snap_pct)], ["Car/g", (p) => fmt(p.carries_pg)], ["Rush yd/g", (p) => fmt(p.rush_yds_pg)],
        ["YPC", (p) => (p.carries_pg ? fmt(p.rush_yds_pg / p.carries_pg, 1) : "—")], ["Rush TD", (p) => p.rush_tds],
        ["Tgt/g", (p) => fmt(p.targets_pg)], ["Rec/g", (p) => fmt(p.receptions_pg)], ["Rec yd/g", (p) => fmt(p.rec_yds_pg)],
        ["Rec TD", (p) => p.rec_tds],
      ] : [
        ["Snap%", (p) => pct(p.snap_pct)], ["Tgt%", (p) => pct(p.target_share)], ["Tgt/g", (p) => fmt(p.targets_pg)],
        ["Rec/g", (p) => fmt(p.receptions_pg)], ["Rec yd/g", (p) => fmt(p.rec_yds_pg)],
        ["YPR", (p) => (p.receptions_pg ? fmt(p.rec_yds_pg / p.receptions_pg, 1) : "—")], ["Rec TD", (p) => p.rec_tds],
      ]
    ),

    defensePositions: ["QB", "RB", "WR", "TE"],
    defenseColumns: [
      ["FP/g", (d) => fmt(d.fantasy_pg_allowed)], ["Yds/g", (d) => fmt(d.yards_pg_allowed)], ["TD/g", (d) => fmt(d.tds_pg_allowed, 2)],
    ],
    defenseLabel: "Defense allowed by position (per game)",
    matchupStats: (d) => [["FP/g", fmt(d.fantasy_pg_allowed)], ["yds/g", fmt(d.yards_pg_allowed)], ["TD/g", fmt(d.tds_pg_allowed, 2)]],

    teamMetrics: (f) => [
      { label: "Record", value: f.record }, { label: "Scored/g", value: fmt(f.ppg) },
      { label: "Allowed/g", value: fmt(f.papg) }, netTile(f),
    ],
    splitRows: (f) => [
      ["Home", f.home_away_split.home], ["Away", f.home_away_split.away],
      ["Divisional", f.div_split.divisional], ["Non-div", f.div_split.non_divisional],
    ],
    usageTiles: (p) => {
      const t = [["Games", p.games], ["Snap%", pct(p.snap_pct)]];
      if (p.position === "QB") t.push(["Pass yds/g", fmt(p.pass_yds_pg)], ["Pass TD", p.pass_tds], ["Car/g", fmt(p.carries_pg)], ["Rush yds/g", fmt(p.rush_yds_pg)]);
      else if (p.position === "RB") t.push(["Car/g", fmt(p.carries_pg)], ["Rush yds/g", fmt(p.rush_yds_pg)], ["Tgt/g", fmt(p.targets_pg)], ["Rec/g", fmt(p.receptions_pg)]);
      else t.push(["Tgt%", pct(p.target_share)], ["Tgt/g", fmt(p.targets_pg)], ["Rec/g", fmt(p.receptions_pg)], ["Rec yds/g", fmt(p.rec_yds_pg)]);
      return t;
    },

    availKey: "injuries",
    availTitle: (team) => `${team} injuries`,
    availFilter: { label: "Min snap%", suffix: "%", min: 0, max: 100, step: 1, field: "snap_pct", scale: 100 },
    logAvailCol: { label: "Snap%", fn: (l) => pct(l.snap_pct) },
    // "Similar players vs X": opponent's faced-log rows filtered to the player's
    // avg snap% minus a cushion (threshold in the availFilter's units).
    similar: {
      base: (p) => (p.snap_pct != null ? Math.round(p.snap_pct * 100) : null),
      cushion: 5,
      baseText: (v) => `${v}% of snaps`,
    },

    gameHeadSub: (g) => `${g.weekday} · ${g.gameday}${g.gametime ? ` · ${g.gametime}` : ""}`,
    gameLineRow: (g) => [["Spread", spreadText(g)], ["Total", fmt(g.total_line)], ["Roof", g.roof || "—"], ["Surface", g.surface || "—"]],
    gameCardMeta: (g) => `${g.weekday} · ${g.gameday}`,
    gameCardLine: (g) => [["Spread", spreadText(g)], ["Total", fmt(g.total_line)]],

    // out teammates = roster flag or injury report Out/Doubtful
    outTeammates: (teamData, teammates) => {
      const injOut = new Set((teamData.injuries || [])
        .filter((i) => i.report_status === "Out" || i.report_status === "Doubtful")
        .map((i) => i.name.toLowerCase()));
      return teammates.filter((m) => m.status || injOut.has(m.name.toLowerCase())).map((m) => m.player_id);
    },
  },

  nba: {
    key: "nba",
    label: "NBA",
    logo: "🏀",
    usageSort: (p) => p.min_pg || 0,
    tagline: "Data-driven NBA edges — all judgments come from official box scores.",
    slateListKey: "slates",
    slateSelectLabel: "Date",
    slateOptionLabel: (s) => s.label,
    stamp: (idx) =>
      `${idx.games.length} games · stats through ${idx.stats_through || "—"} · data generated ${new Date(idx.generated_at).toLocaleString()}`,

    statOptions: NBA_STATS,
    defaultStat: () => "pts",
    positions: ["G", "F", "C"],
    posName: { G: "Guards", F: "Forwards", C: "Centers" },
    bucket: { G: "G", F: "F", C: "C" },

    usageColumns: () => [
      ["MIN", (p) => fmt(p.min_pg)], ["PTS", (p) => fmt(p.pts_pg)], ["REB", (p) => fmt(p.reb_pg)], ["AST", (p) => fmt(p.ast_pg)],
      ["3PM", (p) => fmt(p.fg3m_pg)], ["FG%", (p) => pct(p.fg_pct)], ["STL", (p) => fmt(p.stl_pg)], ["BLK", (p) => fmt(p.blk_pg)],
      ["TO", (p) => fmt(p.to_pg)], ["Start%", (p) => pct(p.starter_rate)],
    ],

    defensePositions: ["G", "F", "C"],
    defenseColumns: [
      ["FP/g", (d) => fmt(d.fantasy_pg_allowed)], ["Pts/g", (d) => fmt(d.pts_pg_allowed)],
      ["Reb/g", (d) => fmt(d.reb_pg_allowed)], ["Ast/g", (d) => fmt(d.ast_pg_allowed)],
    ],
    defenseLabel: "Defense allowed by position (per game, G/F/C)",
    matchupStats: (d) => [["FP/g", fmt(d.fantasy_pg_allowed)], ["pts/g", fmt(d.pts_pg_allowed)], ["reb/g", fmt(d.reb_pg_allowed)], ["ast/g", fmt(d.ast_pg_allowed)]],

    teamMetrics: (f) => [
      { label: "Record", value: f.record }, { label: "PPG", value: fmt(f.ppg) },
      { label: "Opp PPG", value: fmt(f.papg) },
      { label: "Rest", value: f.rest_days == null ? "—" : `${f.rest_days}d`, cls: f.back_to_back ? "under" : "" },
    ],
    splitRows: (f) => [["Home", f.home_away_split.home], ["Away", f.home_away_split.away]],
    usageTiles: (p) => [
      ["Games", p.games], ["MIN", fmt(p.min_pg)], ["PTS", fmt(p.pts_pg)],
      ["REB", fmt(p.reb_pg)], ["AST", fmt(p.ast_pg)], ["3PM", fmt(p.fg3m_pg)],
    ],

    availKey: "dnps",
    availTitle: (team) => `${team} recent DNPs`,
    availFilter: { label: "Min minutes", suffix: "", min: 0, max: 44, step: 1, field: "min", scale: 1 },
    logAvailCol: { label: "Min", fn: (l) => fmt(l.min, 0) },

    gameHeadSub: (g) => `${new Date(g.date + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
    gameLineRow: (g) => [["Tip", g.tipoff], ["Status", g.status === "pre" ? "Scheduled" : g.status === "post" ? "Final" : "Live"]],
    gameCardMeta: (g) => g.tipoff,
    gameCardLine: () => [],

    // out teammates = anyone on the recent-DNP list
    outTeammates: (teamData, teammates) => {
      const dnpIds = new Set((teamData.dnps || []).map((d) => d.player_id));
      return teammates.filter((m) => dnpIds.has(m.player_id)).map((m) => m.player_id);
    },
  },
};

export const statOption = (cfg, key) => cfg.statOptions.find((o) => o.key === key);
export const statsForPosition = (cfg, pos) => {
  const b = cfg.bucket[pos] || pos;
  return cfg.statOptions.filter((o) => o.positions.includes(b));
};
export const defaultStatFor = (cfg, pos) => {
  const avail = statsForPosition(cfg, pos);
  return avail.find((o) => o.key === cfg.defaultStat(pos))?.key || avail[0]?.key;
};

// Prop-checker math over a player's per-game logs. Pure functions so they are
// easy to reason about and could be unit-tested.

// Each option carries the positions it applies to and a slider range tuned to
// the stat (min/max/step), with defaults sitting on the step grid.
export const STAT_OPTIONS = [
  { key: "rec_yds", label: "Receiving yards", positions: ["WR", "TE", "RB"], def: 40.5, min: 10.5, max: 150.5, step: 5, dec: 1 },
  { key: "receptions", label: "Receptions", positions: ["WR", "TE", "RB"], def: 3.5, min: 0.5, max: 12.5, step: 1, dec: 0 },
  { key: "targets", label: "Targets", positions: ["WR", "TE", "RB"], def: 5.5, min: 0.5, max: 15.5, step: 1, dec: 0 },
  { key: "rush_yds", label: "Rushing yards", positions: ["RB", "QB"], def: 40.5, min: 10.5, max: 150.5, step: 5, dec: 1 },
  { key: "carries", label: "Rush attempts", positions: ["RB", "QB"], def: 10.5, min: 2.5, max: 29.5, step: 1, dec: 0 },
  { key: "scrim_yds", label: "Rush + Rec yards", positions: ["RB", "WR", "TE"], def: 60.5, min: 20.5, max: 200.5, step: 5, dec: 1, compute: (r) => r.rush_yds + r.rec_yds },
  { key: "pass_yds", label: "Passing yards", positions: ["QB"], def: 224.5, min: 149.5, max: 349.5, step: 5, dec: 1 },
  { key: "pass_tds", label: "Passing TDs", positions: ["QB"], def: 1.5, min: 0.5, max: 5.5, step: 1, dec: 0 },
  { key: "anytime_td", label: "Anytime TD", positions: ["QB", "RB", "WR", "TE"], def: 0.5, min: 0.5, max: 2.5, step: 1, dec: 0, compute: (r) => r.rush_tds + r.rec_tds },
];

// FB shares RB's prop menu; otherwise use the listed position.
const STAT_BUCKET = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" };
export const statsForPosition = (pos) => {
  const b = STAT_BUCKET[pos] || pos;
  return STAT_OPTIONS.filter((o) => o.positions.includes(b));
};
// A sensible default prop for a position (falls back to the first available).
export const defaultStatFor = (pos) => {
  const avail = statsForPosition(pos);
  const pref = pos === "QB" ? "pass_yds" : pos === "RB" || pos === "FB" ? "rush_yds" : "rec_yds";
  return avail.find((o) => o.key === pref)?.key || avail[0]?.key;
};

export const statOption = (key) => STAT_OPTIONS.find((o) => o.key === key);
export const statVal = (opt, row) => (opt.compute ? opt.compute(row) : row[opt.key] ?? 0);

export function filterLogs(logs, f) {
  return logs.filter((l) => {
    if (f.season !== "all" && String(l.season) !== String(f.season)) return false;
    if (f.venue === "home" && l.home !== true) return false;
    if (f.venue === "away" && l.home !== false) return false;
    if (f.div === "div" && !l.div_game) return false;
    if (f.div === "nondiv" && l.div_game) return false;
    if (f.opp !== "all" && l.opponent !== f.opp) return false;
    return true;
  });
}

export function computeProp(logs, optKey, line, filters) {
  const opt = statOption(optKey);
  const rows = filterLogs(logs, filters).sort(
    (a, b) => a.season - b.season || a.week - b.week
  );
  const vals = rows.map((l) => statVal(opt, l));
  const n = vals.length;
  if (!n) return { opt, rows: [], vals: [], n: 0 };

  const hasLine = !Number.isNaN(line);
  const overs = hasLine ? vals.filter((v) => v > line).length : null;
  const avg = vals.reduce((a, b) => a + b, 0) / n;
  const sorted = vals.slice().sort((a, b) => a - b);
  const med =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const l5 = vals.slice(-5);
  const l5overs = hasLine ? l5.filter((v) => v > line).length : null;

  return {
    opt, rows, vals, n,
    overs, hitRate: hasLine ? overs / n : null,
    avg, med, l5n: l5.length, l5overs,
  };
}

// Group with/without across one or more teammates.
//   "with"    = games where EVERY selected teammate played
//   "without" = games where NO selected teammate played
//   mixed games (some in, some out) are excluded from both.
// With a single teammate this is the usual with/without split.
export function computeWithWithout(playerLogs, mateLogsList, optKey) {
  const opt = statOption(optKey);
  const playedSets = mateLogsList.map(
    (logs) => new Set(logs.map((l) => `${l.season}-${l.week}`))
  );
  const withG = [], withoutG = [];
  let mixedN = 0;
  playerLogs.forEach((l) => {
    const key = `${l.season}-${l.week}`;
    const presences = playedSets.map((s) => s.has(key));
    const val = statVal(opt, l);
    if (presences.every(Boolean)) withG.push(val);
    else if (presences.every((p) => !p)) withoutG.push(val);
    else mixedN += 1;
  });
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    opt,
    withN: withG.length, withAvg: avg(withG),
    withoutN: withoutG.length, withoutAvg: avg(withoutG),
    mixedN,
  };
}

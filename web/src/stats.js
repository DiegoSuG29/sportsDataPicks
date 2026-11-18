// Prop-checker math over a player's per-game logs. Pure functions so they are
// easy to reason about and could be unit-tested.

export const STAT_OPTIONS = [
  { key: "rec_yds", label: "Receiving yards", def: 40.5, dec: 1 },
  { key: "receptions", label: "Receptions", def: 3.5, dec: 0 },
  { key: "targets", label: "Targets", def: 5.5, dec: 0 },
  { key: "rush_yds", label: "Rushing yards", def: 40.5, dec: 1 },
  { key: "carries", label: "Rush attempts", def: 10.5, dec: 0 },
  { key: "scrim_yds", label: "Rush + Rec yards", def: 60.5, dec: 1, compute: (r) => r.rush_yds + r.rec_yds },
  { key: "pass_yds", label: "Passing yards", def: 224.5, dec: 1 },
  { key: "pass_tds", label: "Passing TDs", def: 1.5, dec: 0 },
  { key: "anytime_td", label: "Anytime TD", def: 0.5, dec: 0, compute: (r) => r.rush_tds + r.rec_tds },
];

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

export function computeWithWithout(playerLogs, mateLogs, optKey) {
  const opt = statOption(optKey);
  const matePlayed = new Set(mateLogs.map((l) => `${l.season}-${l.week}`));
  const withG = [], withoutG = [];
  playerLogs.forEach((l) => {
    (matePlayed.has(`${l.season}-${l.week}`) ? withG : withoutG).push(statVal(opt, l));
  });
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return { opt, withN: withG.length, withAvg: avg(withG), withoutN: withoutG.length, withoutAvg: avg(withoutG) };
}

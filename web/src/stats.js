// Prop-checker math over a player's per-game logs. Pure, sport-agnostic:
// callers pass the resolved stat option (from sports.js) and an optional
// availability filter ({ field, scale } — e.g. snap% for NFL, minutes for NBA).

export const statVal = (opt, row) => (opt.compute ? opt.compute(row) : row[opt.key] ?? 0);

// Newest-first secondary key: NFL rows carry `week`, NBA rows carry `date`.
const seasonKey = (l) => (l.week != null ? l.week : l.date);

export function filterLogs(logs, f, avail) {
  return logs.filter((l) => {
    if (f.season !== "all" && String(l.season) !== String(f.season)) return false;
    if (f.venue === "home" && l.home !== true) return false;
    if (f.venue === "away" && l.home !== false) return false;
    if (f.div === "div" && !l.div_game) return false;
    if (f.div === "nondiv" && l.div_game) return false;
    if (f.opp !== "all" && l.opponent !== f.opp) return false;
    if (avail && Number(f.avail) > 0) {
      const v = l[avail.field];
      if (v == null || v * (avail.scale || 1) < Number(f.avail)) return false;
    }
    return true;
  });
}

export function computeProp(logs, opt, line, filters, avail) {
  const rows = filterLogs(logs, filters, avail).sort((a, b) => {
    if (b.season !== a.season) return b.season - a.season;
    const ka = seasonKey(a), kb = seasonKey(b);
    return kb > ka ? 1 : kb < ka ? -1 : 0; // newest first
  });
  const vals = rows.map((l) => statVal(opt, l));
  const n = vals.length;
  if (!n) return { opt, rows: [], vals: [], n: 0 };

  const hasLine = !Number.isNaN(line);
  const overs = hasLine ? vals.filter((v) => v > line).length : null;
  const avg = vals.reduce((a, b) => a + b, 0) / n;
  const sorted = vals.slice().sort((a, b) => a - b);
  const med = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const l5 = vals.slice(0, 5); // rows are newest-first, so the first 5 are the last 5 games
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
export function computeWithWithout(playerLogs, mateLogsList, opt) {
  const gameKey = (l) => `${l.season}-${l.week != null ? l.week : l.date}`;
  const playedSets = mateLogsList.map((logs) => new Set(logs.map(gameKey)));
  const withG = [], withoutG = [];
  let mixedN = 0;
  playerLogs.forEach((l) => {
    const key = gameKey(l);
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

export const fmt = (v, d = 1) =>
  v == null || Number.isNaN(v) ? "—" : (+v).toFixed(d);

export const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

// Map a listed position to its color class (FB shares RB's color).
const POS_CLASS = { QB: "pos-QB", RB: "pos-RB", FB: "pos-RB", WR: "pos-WR", TE: "pos-TE" };
export const posClass = (p) => POS_CLASS[p] || "";

// Roster special-circumstance code → chip tone (see styles.css .flag.*)
export const FLAG_TONE = {
  IR: "out", INACTIVE: "out", RESERVE: "out", NFI: "out", DNR: "out",
  RELEASED: "out", RETIRED: "out", SUSP: "out",
  PUP: "warn", TRADED: "info", "PRACTICE SQ": "muted",
};

export function spreadText(game) {
  const s = game.spread_line;
  if (s == null) return "—";
  if (s === 0) return "Pick'em";
  return s > 0 ? `${game.home_team} -${s}` : `${game.away_team} -${Math.abs(s)}`;
}

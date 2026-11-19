export const fmt = (v, d = 1) =>
  v == null || Number.isNaN(v) ? "—" : (+v).toFixed(d);

export const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

// Map a listed position to its color class (FB shares RB's color).
// NBA G/F/C reuse the NFL palette slots.
const POS_CLASS = {
  QB: "pos-QB", RB: "pos-RB", FB: "pos-RB", WR: "pos-WR", TE: "pos-TE",
  G: "pos-QB", F: "pos-WR", C: "pos-RB",
};
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

// Practice participation → short label + chip class.
// Source strings: "Full Participation in Practice",
// "Limited Participation in Practice", "Did Not Participate In Practice".
export function practiceTag(s) {
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.startsWith("full")) return { label: "Full", cls: "prac-full" };
  if (t.startsWith("limited")) return { label: "Limited", cls: "prac-ltd" };
  if (t.startsWith("did not") || t.startsWith("dnp")) return { label: "DNP", cls: "prac-dnp" };
  return { label: s, cls: "" };
}

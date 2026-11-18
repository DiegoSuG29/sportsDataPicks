export const fmt = (v, d = 1) =>
  v == null || Number.isNaN(v) ? "—" : (+v).toFixed(d);

export const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

export function spreadText(game) {
  const s = game.spread_line;
  if (s == null) return "—";
  if (s === 0) return "Pick'em";
  return s > 0 ? `${game.home_team} -${s}` : `${game.away_team} -${Math.abs(s)}`;
}

import { Team } from "../logos.jsx";

// Horizontal strip of the week's games so you can hop between game views
// without returning to the grid. Sits just under the header.
export default function GameTabs({ games, current, onSelect, onBack }) {
  return (
    <div className="game-tabs">
      <button className="btn ghost tab-back" onClick={onBack}>← All games</button>
      <div className="tab-strip">
        {games.map((g) => (
          <button
            key={g.file}
            className={"tab" + (g.file === current ? " active" : "")}
            onClick={() => onSelect(g.file)}
            title={`${g.away_team} @ ${g.home_team}${g.weekday ? ` · ${g.weekday}` : g.tipoff ? ` · ${g.tipoff}` : ""}`}
          >
            <Team abbr={g.away_team} size={16} /><span className="muted">@</span><Team abbr={g.home_team} size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

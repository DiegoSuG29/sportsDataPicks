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
            title={`${g.away_team} @ ${g.home_team} · ${g.weekday}`}
          >
            {g.away_team}<span className="muted">@</span>{g.home_team}
          </button>
        ))}
      </div>
    </div>
  );
}

import { fmt, spreadText } from "../util.js";

export default function GameList({ games, onOpen }) {
  return (
    <div className="game-list">
      {games.map((g) => (
        <div key={g.file} className="game-card" onClick={() => onOpen(g.file)}>
          <div className="matchup">
            {g.away_team} <span className="muted">@</span> {g.home_team}
          </div>
          <div className="gc-meta">{g.weekday} · {g.gameday}</div>
          <div className="gc-line">
            <span>Spread <b>{spreadText(g)}</b></span>
            <span>Total <b>{fmt(g.total_line)}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}

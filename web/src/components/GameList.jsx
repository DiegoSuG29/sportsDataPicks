import { Team } from "../logos.jsx";

export default function GameList({ cfg, games, onOpen }) {
  return (
    <div className="game-list">
      {games.map((g) => {
        const line = cfg.gameCardLine(g);
        return (
          <div key={g.file} className="game-card" onClick={() => onOpen(g.file)}>
            <div className="matchup">
              <Team abbr={g.away_team} size={26} /> <span className="muted">@</span> <Team abbr={g.home_team} size={26} />
            </div>
            <div className="gc-meta">{cfg.gameCardMeta(g)}</div>
            {line.length > 0 && (
              <div className="gc-line">
                {line.map(([lbl, val]) => <span key={lbl}>{lbl} <b>{val}</b></span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

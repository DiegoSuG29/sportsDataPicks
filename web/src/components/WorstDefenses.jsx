import { posClass } from "../util.js";

// League-wide soft spots: the defenses that allow the most fantasy per position,
// among teams playing on this slate. The listed opponent is the offense to target.
export default function WorstDefenses({ cfg, data, onOpen }) {
  return (
    <section className="worst-def">
      <div className="wd-title">
        <h2>Worst defenses by position</h2>
        <span className="muted">Top 5 soft spots on this slate · the opponent is the offense to target</span>
      </div>
      <div className="wd-grid">
        {cfg.positions.map((pos) => (
          <div className={`wd-col ${posClass(pos)}`} key={pos}>
            <div className="wd-head">{cfg.posName[pos]}</div>
            <ol className="wd-list">
              {(data[pos] || []).map((r) => (
                <li className="wd-row" key={r.team} onClick={() => onOpen(r.game_file)}>
                  <span className="wd-rank">#{r.rank}</span>
                  <span className="wd-team">{r.team}</span>
                  <span className="wd-fp">{r.fantasy_pg_allowed}<span className="wd-u"> FP/g</span></span>
                  <span className="wd-opp">{r.home ? "vs" : "@"} <b>{r.opponent}</b></span>
                </li>
              ))}
              {!(data[pos] || []).length && <li className="empty">No data.</li>}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

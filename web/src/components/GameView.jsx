import { fmt, pct, spreadText, posClass } from "../util.js";

export default function GameView({ game, onPlayer }) {
  return (
    <div className="game-detail">
      <div className="game-head">
        <h2>{game.away_team} @ {game.home_team}</h2>
        <span className="sub">
          {game.weekday} · {game.gameday}{game.gametime ? ` · ${game.gametime}` : ""}
        </span>
        {game.div_game && <span className="pill div">Divisional</span>}
      </div>

      <div className="line-row">
        <div className="box"><span>Spread </span><b>{spreadText(game)}</b></div>
        <div className="box"><span>Total </span><b>{fmt(game.total_line)}</b></div>
        <div className="box"><span>Roof </span><b>{game.roof || "—"}</b></div>
        <div className="box"><span>Surface </span><b>{game.surface || "—"}</b></div>
      </div>

      <PosLegend />

      <Edges edges={game.edges} />

      <div className="teams">
        <TeamPanel game={game} team={game.away_team} venue="Away" onPlayer={onPlayer} />
        <TeamPanel game={game} team={game.home_team} venue="Home" onPlayer={onPlayer} />
      </div>
    </div>
  );
}

function PosLegend() {
  return (
    <div className="pos-legend">
      <span className="k">Positions:</span>
      {["QB", "RB", "WR", "TE"].map((p) => (
        <span className="lg" key={p}><span className={`sw ${p}`} />{p}</span>
      ))}
    </div>
  );
}

function Edges({ edges }) {
  return (
    <div className="edges">
      <h3>Flagged edges {edges.length ? `(${edges.length})` : ""}</h3>
      {!edges.length && <p className="empty">No edges flagged from the data for this game.</p>}
      {edges.map((e, i) => (
        <div className="edge" key={i}>
          <span className={`tag ${e.type}`}>{e.type}</span>
          <div>
            <div className="etext">{e.text}</div>
            {e.stat && <div className="estat">{e.stat}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function splitTxt(s) {
  if (!s || !s.games) return <span className="muted">—</span>;
  return <><b>{fmt(s.ppg)}</b>/<b>{fmt(s.papg)}</b> <span className="muted">({s.games}g)</span></>;
}

function TeamPanel({ game, team, venue, onPlayer }) {
  const t = game.teams[team];
  const f = t.form;
  const ha = f.home_away_split, dv = f.div_split;

  return (
    <div className="team-panel">
      <h3>{team} <span className="muted" style={{ fontSize: 14 }}>({venue})</span></h3>
      <div className="rec">{f.record} · {fmt(f.ppg)} PPG · {fmt(f.papg)} allowed</div>

      <div className="section-label">Form</div>
      <div className="last5">
        {(f.last5 || []).map((g, i) => (
          <span key={i} className={`g-chip ${g[0]}`}>{g}</span>
        ))}
        {(!f.last5 || !f.last5.length) && <span className="empty">no games yet</span>}
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="statline"><span className="k">Home</span> {splitTxt(ha.home)} &nbsp; <span className="k">Away</span> {splitTxt(ha.away)}</div>
        <div className="statline"><span className="k">Div</span> {splitTxt(dv.divisional)} &nbsp; <span className="k">Non-div</span> {splitTxt(dv.non_divisional)}</div>
      </div>

      <div className="section-label">Defense allowed by position (per game)</div>
      <DefenseTable def={t.defense} />
      <div className="loghint">Rank 1 = allows the most (softest matchup).</div>

      <div className="section-label">Usage — click a player for props & splits</div>
      <UsageTable usage={t.usage} onPlayer={(p) => onPlayer(team, p)} />

      <div className="section-label">Injury report</div>
      <InjuryList injuries={t.injuries} />
    </div>
  );
}

function DefenseTable({ def }) {
  const order = ["QB", "RB", "WR", "TE"];
  return (
    <table>
      <thead><tr><th>Pos</th><th>FP/g</th><th>Yds/g</th><th>TD/g</th><th>Rank</th></tr></thead>
      <tbody>
        {order.map((pos) => {
          const d = def[pos];
          if (!d) return null;
          const cls = d.rank_most_allowed <= 8 ? "rank-bad"
            : d.rank_most_allowed >= d.of_teams - 7 ? "rank-good" : "";
          return (
            <tr key={pos}>
              <td>{pos}</td>
              <td>{fmt(d.fantasy_pg_allowed)}</td>
              <td>{fmt(d.yards_pg_allowed)}</td>
              <td>{fmt(d.tds_pg_allowed, 2)}</td>
              <td className={cls}>{d.rank_most_allowed}/{d.of_teams}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// QBs get passing/rushing TDs split; everyone else shows rush+rec combined.
function tdCell(p) {
  if (p.position === "QB") {
    return <span title="passing / rushing TDs">{p.pass_tds}<span className="muted">p</span> / {p.rush_tds}<span className="muted">r</span></span>;
  }
  const total = (p.rush_tds || 0) + (p.rec_tds || 0);
  return <span title="rushing + receiving TDs">{total}</span>;
}

function UsageTable({ usage, onPlayer }) {
  return (
    <table>
      <thead><tr><th>Player</th><th>Snap%</th><th>Tgt%</th><th>Tgt/g</th><th>Rec/g</th><th>Car/g</th><th>TD</th></tr></thead>
      <tbody>
        {!usage.length && <tr><td colSpan={7} className="empty">No usage data.</td></tr>}
        {usage.map((p) => (
          <tr key={p.player_id} className={`clickable ${posClass(p.position)}`} onClick={() => onPlayer(p)}>
            <td>{p.name}<span className={`pos-tag ${posClass(p.position)}`}>{p.position}</span></td>
            <td>{pct(p.snap_pct)}</td>
            <td>{pct(p.target_share)}</td>
            <td>{fmt(p.targets_pg)}</td>
            <td>{fmt(p.receptions_pg)}</td>
            <td>{fmt(p.carries_pg)}</td>
            <td>{tdCell(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InjuryList({ injuries }) {
  if (!injuries.length) return <p className="empty">No injuries reported.</p>;
  return (
    <div>
      {injuries.map((i, idx) => (
        <div className="inj-row" key={idx}>
          <span>
            {i.name} <span className={`pos-tag ${posClass(i.position)}`}>{i.position}</span>{" "}
            <span className="muted">{i.injury || ""}{i.games_missed != null ? ` · ${i.games_missed} missed` : ""}</span>
          </span>
          <span className={`status ${i.report_status || ""}`}>
            {i.report_status || i.practice_status || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

import { useState } from "react";
import { fmt, pct, spreadText, posClass, FLAG_TONE } from "../util.js";

const POS_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends", FB: "Fullbacks" };
const INJ_SHORT = { Out: "OUT", Doubtful: "DOUBT", Questionable: "QUES" };
const BUCKET = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" };

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

      <Edges edges={game.edges} />

      <div className="teams">
        <TeamCard game={game} team={game.away_team} venue="Away" />
        <TeamCard game={game} team={game.home_team} venue="Home" />
      </div>

      <UsageSection key={game.game_id} game={game} onPlayer={onPlayer} />

      <div className="teams">
        <InjuryCard team={game.away_team} injuries={game.teams[game.away_team].injuries} />
        <InjuryCard team={game.home_team} injuries={game.teams[game.home_team].injuries} />
      </div>
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
          <span className={`tag ${e.type} ${e.tier || ""}`}>{e.type === "matchup" ? e.tier : e.type}</span>
          <div>
            <div className="etext">{e.text}</div>
            {e.stat && <div className="estat">{e.stat}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Headline team numbers, including point differential.
function TeamMetrics({ f }) {
  const net = (f.ppg ?? 0) - (f.papg ?? 0);
  const netCls = net > 0 ? "over" : net < 0 ? "under" : "";
  return (
    <div className="team-metrics">
      <div className="tm"><div className="tm-big">{f.record}</div><div className="tm-lbl">Record</div></div>
      <div className="tm"><div className="tm-big">{fmt(f.ppg)}</div><div className="tm-lbl">Scored/g</div></div>
      <div className="tm"><div className="tm-big">{fmt(f.papg)}</div><div className="tm-lbl">Allowed/g</div></div>
      <div className="tm"><div className={`tm-big ${netCls}`}>{net > 0 ? "+" : ""}{fmt(net)}</div><div className="tm-lbl">Net/g</div></div>
    </div>
  );
}

// Each last5 entry looks like "L 20-26 vs TEN"; split result from the rest.
function FormList({ last5 }) {
  if (!last5 || !last5.length) return <p className="empty">No games yet.</p>;
  return (
    <div className="form-list">
      {last5.map((g, i) => {
        const res = g.split(" ")[0];
        const rest = g.slice(res.length + 1);
        return (
          <div className={`fg ${res}`} key={i}>
            <span className={`fg-res ${res}`}>{res}</span>
            <span className="fg-rest">{rest}</span>
          </div>
        );
      })}
    </div>
  );
}

function SplitTable({ ha, dv }) {
  const rows = [
    ["Home", ha.home], ["Away", ha.away],
    ["Divisional", dv.divisional], ["Non-div", dv.non_divisional],
  ];
  return (
    <div className="table-wrap">
      <table className="split-table">
        <thead><tr><th>Split</th><th>Scored</th><th>Allowed</th><th>Net</th><th>GP</th></tr></thead>
        <tbody>
          {rows.map(([label, s]) => {
            if (!s || !s.games) {
              return <tr key={label}><td>{label}</td><td colSpan={4} className="muted">no games</td></tr>;
            }
            const net = s.ppg - s.papg;
            return (
              <tr key={label}>
                <td>{label}</td>
                <td>{fmt(s.ppg)}</td>
                <td>{fmt(s.papg)}</td>
                <td className={net > 0 ? "over" : net < 0 ? "under" : ""}>{net > 0 ? "+" : ""}{fmt(net)}</td>
                <td className="muted">{s.games}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Team summary card (form, splits, defense). Usage/injuries live elsewhere now.
function TeamCard({ game, team, venue }) {
  const t = game.teams[team];
  const f = t.form;
  const ha = f.home_away_split, dv = f.div_split;
  return (
    <div className="team-panel">
      <span className="panel-kind">Team</span>
      <h3>{team} <span className="muted" style={{ fontSize: 14 }}>({venue})</span></h3>

      <TeamMetrics f={f} />

      <div className="section-label">Last {(f.last5 || []).length} games (most recent first)</div>
      <FormList last5={f.last5} />

      <div className="section-label">Situational splits — scored / allowed per game</div>
      <SplitTable ha={ha} dv={dv} />

      <div className="section-label">Defense allowed by position (per game)</div>
      <DefenseTable def={t.defense} />
      <div className="loghint">
        Matchup is for the opposing player: <span className="over">Soft</span> = this defense gives up a lot to that
        position (favorable), <span className="under">Tough</span> = stingy. Rank 1 = allows the most.
      </div>
    </div>
  );
}

function DefenseTable({ def }) {
  const order = ["QB", "RB", "WR", "TE"];
  const MATCHUP = { soft: "Soft", avg: "Avg", tough: "Tough" };
  return (
    <div className="table-wrap">
      <table className="def-table">
        <thead><tr><th>Pos</th><th>FP/g</th><th>Yds/g</th><th>TD/g</th><th>Matchup</th></tr></thead>
        <tbody>
          {order.map((pos) => {
            const d = def[pos];
            if (!d) return null;
            const third = d.of_teams / 3;
            const tier = d.rank_most_allowed <= third ? "soft"
              : d.rank_most_allowed > 2 * third ? "tough" : "avg";
            return (
              <tr key={pos} className={posClass(pos)}>
                <td><span className={`pos-tag ${posClass(pos)}`}>{pos}</span></td>
                <td>{fmt(d.fantasy_pg_allowed)}</td>
                <td>{fmt(d.yards_pg_allowed)}</td>
                <td>{fmt(d.tds_pg_allowed, 2)}</td>
                <td>
                  <span className={`matchup ${tier}`}>{MATCHUP[tier]}</span>
                  <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{d.rank_most_allowed}/{d.of_teams}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Single full-width usage area with a team toggle, split into per-position grids.
function UsageSection({ game, onPlayer }) {
  const teams = [game.away_team, game.home_team];
  const [team, setTeam] = useState(teams[0]);
  const active = game.teams[team] ? team : teams[0];
  const t = game.teams[active];

  return (
    <div className="team-panel usage-section">
      <div className="usage-head">
        <span className="panel-kind">Players usage — position breakdown</span>
        <div className="team-toggle" role="tablist">
          {teams.map((tm) => (
            <button
              key={tm}
              className={`tt-btn ${tm === active ? "active" : ""}`}
              onClick={() => setTeam(tm)}
            >
              {tm}
            </button>
          ))}
        </div>
      </div>
      <div className="loghint">Each position shows its most relevant stats, highest snap share first. Click a player for props &amp; splits.</div>
      <PositionGrids usage={t.usage} injuries={t.injuries} onPlayer={(p) => onPlayer(active, p)} />
    </div>
  );
}

// Position-specific column sets (season per-game figures + ratios).
function columnsFor(bucket) {
  if (bucket === "QB") return [
    ["Snap%", (p) => pct(p.snap_pct)],
    ["Comp%", (p) => (p.attempts ? pct(p.completions / p.attempts) : "—")],
    ["Comp/g", (p) => (p.games ? fmt(p.completions / p.games) : "—")],
    ["Yds/g", (p) => fmt(p.pass_yds_pg)],
    ["Pass TD", (p) => p.pass_tds],
    ["INT", (p) => p.interceptions],
    ["Rush att/g", (p) => fmt(p.carries_pg)],
    ["Rush yd/g", (p) => fmt(p.rush_yds_pg)],
  ];
  if (bucket === "RB") return [
    ["Snap%", (p) => pct(p.snap_pct)],
    ["Car/g", (p) => fmt(p.carries_pg)],
    ["Rush yd/g", (p) => fmt(p.rush_yds_pg)],
    ["YPC", (p) => (p.carries_pg ? fmt(p.rush_yds_pg / p.carries_pg, 1) : "—")],
    ["Rush TD", (p) => p.rush_tds],
    ["Tgt/g", (p) => fmt(p.targets_pg)],
    ["Rec/g", (p) => fmt(p.receptions_pg)],
    ["Rec yd/g", (p) => fmt(p.rec_yds_pg)],
    ["Rec TD", (p) => p.rec_tds],
  ];
  // WR / TE
  return [
    ["Snap%", (p) => pct(p.snap_pct)],
    ["Tgt%", (p) => pct(p.target_share)],
    ["Tgt/g", (p) => fmt(p.targets_pg)],
    ["Rec/g", (p) => fmt(p.receptions_pg)],
    ["Rec yd/g", (p) => fmt(p.rec_yds_pg)],
    ["YPR", (p) => (p.receptions_pg ? fmt(p.rec_yds_pg / p.receptions_pg, 1) : "—")],
    ["Rec TD", (p) => p.rec_tds],
  ];
}

function PositionGrids({ usage, injuries, onPlayer }) {
  const known = ["QB", "RB", "WR", "TE"];
  const byPos = {};
  usage.forEach((p) => (byPos[p.position] ||= []).push(p));
  const positions = [
    ...known.filter((p) => byPos[p]),
    ...Object.keys(byPos).filter((p) => !known.includes(p)),
  ];
  const injByName = {};
  (injuries || []).forEach((i) => { if (i.report_status) injByName[i.name] = i; });

  if (!usage.length) return <p className="empty">No usage data.</p>;
  return (
    <div className="pos-grids">
      {positions.map((pos) => (
        <PositionTable
          key={pos}
          pos={pos}
          players={byPos[pos].slice().sort((a, b) => (b.snap_pct || 0) - (a.snap_pct || 0))}
          injByName={injByName}
          onPlayer={onPlayer}
        />
      ))}
    </div>
  );
}

function PositionTable({ pos, players, injByName, onPlayer }) {
  const cols = columnsFor(BUCKET[pos] || pos);
  return (
    <div className="pos-grid">
      <div className={`pos-grid-head ${posClass(pos)}`}>{POS_NAME[pos] || pos}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Player</th>{cols.map((c) => <th key={c[0]}>{c[0]}</th>)}</tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const inj = injByName[p.name];
              return (
                <tr key={p.player_id} className={`clickable ${posClass(p.position)}`} onClick={() => onPlayer(p)}>
                  <td>
                    {p.name}
                    {p.status ? (
                      <span className={`flag ${FLAG_TONE[p.status] || "muted"}`} title={p.status_note || p.status}>{p.status}</span>
                    ) : inj && (
                      <span className={`status ${inj.report_status}`} style={{ marginLeft: 6 }}
                        title={`${inj.report_status}${inj.injury ? ` · ${inj.injury}` : ""}`}>
                        {INJ_SHORT[inj.report_status] || inj.report_status}
                      </span>
                    )}
                  </td>
                  {cols.map((c) => <td key={c[0]}>{c[1](p)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InjuryCard({ team, injuries }) {
  return (
    <div className="team-panel">
      <span className="panel-kind">Injury report</span>
      <h3 style={{ fontSize: 18 }}>{team} injuries</h3>
      <InjuryList injuries={injuries} />
    </div>
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

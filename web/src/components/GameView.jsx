import { useState } from "react";
import { fmt, posClass, FLAG_TONE } from "../util.js";

const INJ_SHORT = { Out: "OUT", Doubtful: "DOUBT", Questionable: "QUES" };

export default function GameView({ cfg, game, onPlayer }) {
  const AvailCard = cfg.availKey === "dnps" ? DnpCard : InjuryCard;
  return (
    <div className="game-detail">
      <div className="game-head">
        <h2>{game.away_team} @ {game.home_team}</h2>
        <span className="sub">{cfg.gameHeadSub(game)}</span>
        {game.div_game && <span className="pill div">Divisional</span>}
      </div>

      <div className="line-row">
        {cfg.gameLineRow(game).map(([lbl, val]) => (
          <div className="box" key={lbl}><span>{lbl} </span><b>{val}</b></div>
        ))}
      </div>

      <Edges edges={game.edges || []} />

      <div className="teams">
        <TeamCard cfg={cfg} game={game} team={game.away_team} venue="Away" />
        <TeamCard cfg={cfg} game={game} team={game.home_team} venue="Home" />
      </div>

      <UsageSection key={game.game_id} cfg={cfg} game={game} onPlayer={onPlayer} />

      <div className="teams">
        {[game.away_team, game.home_team].map((tm) => (
          <AvailCard key={tm} cfg={cfg} team={tm} items={game.teams[tm][cfg.availKey] || []} />
        ))}
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

// Headline team numbers (sport-specific tiles from cfg.teamMetrics).
function TeamMetrics({ tiles }) {
  return (
    <div className="team-metrics">
      {tiles.map((t) => (
        <div className="tm" key={t.label}>
          <div className={`tm-big ${t.cls || ""}`}>{t.value}</div>
          <div className="tm-lbl">{t.label}</div>
        </div>
      ))}
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

function SplitTable({ rows }) {
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

// Team summary card (form, splits, defense). Usage/availability live elsewhere.
function TeamCard({ cfg, game, team, venue }) {
  const t = game.teams[team];
  const f = t.form;
  return (
    <div className="team-panel">
      <span className="panel-kind">Team</span>
      <h3>{team} <span className="muted" style={{ fontSize: 14 }}>({venue})</span></h3>

      <TeamMetrics tiles={cfg.teamMetrics(f)} />
      {f.back_to_back && <div className="loghint"><span className="under">Back-to-back</span>: played yesterday.</div>}

      <div className="section-label">Last {(f.last5 || []).length} games (most recent first)</div>
      <FormList last5={f.last5} />

      <div className="section-label">Situational splits — scored / allowed per game</div>
      <SplitTable rows={cfg.splitRows(f)} />

      <div className="section-label">{cfg.defenseLabel}</div>
      <DefenseTable cfg={cfg} def={t.defense} />
      <div className="loghint">
        Matchup is for the opposing player: <span className="over">Soft</span> = this defense gives up a lot to that
        position (favorable), <span className="under">Tough</span> = stingy. Rank 1 = allows the most.
      </div>
    </div>
  );
}

export function matchupTier(d) {
  const third = d.of_teams / 3;
  return d.rank_most_allowed <= third ? "soft" : d.rank_most_allowed > 2 * third ? "tough" : "avg";
}

function DefenseTable({ cfg, def }) {
  const MATCHUP = { soft: "Soft", avg: "Avg", tough: "Tough" };
  return (
    <div className="table-wrap">
      <table className="def-table">
        <thead>
          <tr><th>Pos</th>{cfg.defenseColumns.map((c) => <th key={c[0]}>{c[0]}</th>)}<th>Matchup</th></tr>
        </thead>
        <tbody>
          {cfg.defensePositions.map((pos) => {
            const d = def?.[pos];
            if (!d) return null;
            const tier = matchupTier(d);
            return (
              <tr key={pos} className={posClass(pos)}>
                <td><span className={`pos-tag ${posClass(pos)}`}>{pos}</span></td>
                {cfg.defenseColumns.map((c) => <td key={c[0]}>{c[1](d)}</td>)}
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
function UsageSection({ cfg, game, onPlayer }) {
  const teams = [game.away_team, game.home_team];
  const [team, setTeam] = useState(teams[0]);
  const active = game.teams[team] ? team : teams[0];
  const t = game.teams[active];
  const shareWord = cfg.key === "nba" ? "most minutes" : "highest snap share";

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
      <div className="loghint">Each position shows its most relevant stats, {shareWord} first. Click a player for props &amp; splits.</div>
      <PositionGrids cfg={cfg} usage={t.usage} injuries={t.injuries} dnps={t.dnps} onPlayer={(p) => onPlayer(active, p)} />
    </div>
  );
}

function PositionGrids({ cfg, usage, injuries, dnps, onPlayer }) {
  const known = cfg.positions;
  const byPos = {};
  usage.forEach((p) => (byPos[p.position] ||= []).push(p));
  const positions = [
    ...known.filter((p) => byPos[p]),
    ...Object.keys(byPos).filter((p) => !known.includes(p)),
  ];
  const injByName = {};
  (injuries || []).forEach((i) => { if (i.report_status) injByName[i.name] = i; });
  const dnpById = {};
  (dnps || []).forEach((d) => { dnpById[d.player_id] = d; });

  if (!usage.length) return <p className="empty">No usage data.</p>;
  return (
    <div className="pos-grids">
      {positions.map((pos) => (
        <PositionTable
          key={pos}
          cfg={cfg}
          pos={pos}
          players={byPos[pos].slice().sort((a, b) => cfg.usageSort(b) - cfg.usageSort(a))}
          injByName={injByName}
          dnpById={dnpById}
          onPlayer={onPlayer}
        />
      ))}
    </div>
  );
}

function PositionTable({ cfg, pos, players, injByName, dnpById, onPlayer }) {
  const cols = cfg.usageColumns(cfg.bucket[pos] || pos);
  return (
    <div className="pos-grid">
      <div className={`pos-grid-head ${posClass(pos)}`}>{cfg.posName[pos] || pos}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Player</th>{cols.map((c) => <th key={c[0]}>{c[0]}</th>)}</tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const inj = injByName[p.name];
              const dnp = dnpById[p.player_id];
              return (
                <tr key={p.player_id} className={`clickable ${posClass(p.position)}`} onClick={() => onPlayer(p)}>
                  <td>
                    {p.name}
                    {p.status ? (
                      <span className={`flag ${FLAG_TONE[p.status] || "muted"}`} title={p.status_note || p.status}>{p.status}</span>
                    ) : inj ? (
                      <span className={`status ${inj.report_status}`} style={{ marginLeft: 6 }}
                        title={`${inj.report_status}${inj.injury ? ` · ${inj.injury}` : ""}`}>
                        {INJ_SHORT[inj.report_status] || inj.report_status}
                      </span>
                    ) : dnp && (
                      <span className="flag warn" title={`DNP ${dnp.last_dnp}${dnp.reason ? ` · ${dnp.reason}` : ""}`}>DNP</span>
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

function InjuryCard({ cfg, team, items }) {
  return (
    <div className="team-panel">
      <span className="panel-kind">Injury report</span>
      <h3 style={{ fontSize: 18 }}>{cfg.availTitle(team)}</h3>
      <InjuryList injuries={items} />
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

// NBA: no pregame injury feed — show who sat in recent games and why.
function DnpCard({ cfg, team, items }) {
  return (
    <div className="team-panel">
      <span className="panel-kind">Recent availability</span>
      <h3 style={{ fontSize: 18 }}>{cfg.availTitle(team)}</h3>
      {!items.length ? (
        <p className="empty">No recent DNPs.</p>
      ) : (
        <div>
          {items.map((d) => (
            <div className="inj-row" key={d.player_id}>
              <span>
                {d.name} <span className={`pos-tag ${posClass(d.position)}`}>{d.position}</span>{" "}
                <span className="muted">
                  last DNP {d.last_dnp}{d.dnp_games > 1 ? ` · ${d.dnp_games} games` : ""}
                </span>
              </span>
              <span className="status Questionable" title={d.reason || ""}>{d.reason || "DNP"}</span>
            </div>
          ))}
        </div>
      )}
      <div className="loghint">From box scores only. Check the official injury report for tonight's status.</div>
    </div>
  );
}

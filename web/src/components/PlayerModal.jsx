import { useEffect, useMemo, useState } from "react";
import { fmt, posClass } from "../util.js";
import { STAT_OPTIONS, statOption, computeProp, computeWithWithout } from "../stats.js";

export default function PlayerModal({ game, team, player, onClose }) {
  const logs = game.player_logs[player.player_id] || [];
  const opp = team === game.home_team ? game.away_team : game.home_team;
  const teammates = game.teams[team].usage.filter((p) => p.player_id !== player.player_id);
  const seasons = useMemo(() => [...new Set(logs.map((l) => l.season))].sort(), [logs]);

  const defaultStat =
    player.position === "QB" ? "pass_yds" : player.position === "RB" ? "rush_yds" : "rec_yds";

  const [statKey, setStatKey] = useState(defaultStat);
  const [line, setLine] = useState(statOption(defaultStat).def);
  const [filters, setFilters] = useState({ season: "all", venue: "all", div: "all", opp: "all" });
  const [mateIds, setMateIds] = useState(teammates[0] ? [teammates[0].player_id] : []);
  const [wwStat, setWwStat] = useState(defaultStat);

  const toggleMate = (id) =>
    setMateIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onStatChange = (key) => {
    setStatKey(key);
    setLine(statOption(key).def);
  };

  const prop = useMemo(
    () => computeProp(logs, statKey, parseFloat(line), filters),
    [logs, statKey, line, filters]
  );
  const ww = useMemo(() => {
    if (!mateIds.length) return null;
    const mateLogsList = mateIds.map((id) => game.player_logs[id] || []);
    return computeWithWithout(logs, mateLogsList, wwStat);
  }, [logs, mateIds, wwStat, game]);
  const mateNames = mateIds
    .map((id) => teammates.find((m) => m.player_id === id)?.name)
    .filter(Boolean);
  const mateLabel =
    mateNames.length === 0 ? "teammate"
    : mateNames.length === 1 ? mateNames[0]
    : mateNames.length === 2 ? mateNames.join(" & ")
    : `${mateNames.length} teammates`;

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="modal" onClick={(e) => e.target.classList.contains("modal") && onClose()}>
      <div className="modal-card">
        <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>

        <div className="pd-head">
          <h3>{player.name} <span className={`pos-tag ${posClass(player.position)}`}>{player.position}</span></h3>
          <div className="pd-sub">
            {team} · {logs.length} games on record (last season + this season) · this week vs {opp}
          </div>
        </div>

        <div className="section-label">Prop checker</div>
        <div className="prop-grid">
          <label>Stat
            <select value={statKey} onChange={(e) => onStatChange(e.target.value)}>
              {STAT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label>Line
            <input type="number" step="0.5" value={line} onChange={(e) => setLine(e.target.value)} />
          </label>
          <label>Season
            <select value={filters.season} onChange={(e) => setF("season", e.target.value)}>
              <option value="all">All</option>
              {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Venue
            <select value={filters.venue} onChange={(e) => setF("venue", e.target.value)}>
              <option value="all">All</option><option value="home">Home</option><option value="away">Away</option>
            </select>
          </label>
          <label>Division
            <select value={filters.div} onChange={(e) => setF("div", e.target.value)}>
              <option value="all">All</option><option value="div">Divisional</option><option value="nondiv">Non-div</option>
            </select>
          </label>
          <label>Opponent
            <select value={filters.opp} onChange={(e) => setF("opp", e.target.value)}>
              <option value="all">All</option><option value={opp}>vs {opp}</option>
            </select>
          </label>
        </div>

        <PropResult prop={prop} line={parseFloat(line)} />
        <PropLog prop={prop} line={parseFloat(line)} />

        <div className="section-label">With / without teammates</div>
        <div className="ww-wrap">
          {teammates.length ? (
            <>
              <div className="loghint">Pick one or more teammates to toggle in/out.</div>
              <div className="ww-mates">
                {teammates.map((m) => {
                  const on = mateIds.includes(m.player_id);
                  return (
                    <button
                      key={m.player_id}
                      className={`ww-chip ${on ? "on" : ""}`}
                      onClick={() => toggleMate(m.player_id)}
                    >
                      <span className={`pos-tag ${posClass(m.position)}`}>{m.position}</span> {m.name}
                      <span className="pm">{on ? "−" : "+"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="prop-grid">
                <label>Stat
                  <select value={wwStat} onChange={(e) => setWwStat(e.target.value)}>
                    {STAT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              {ww ? (
                <>
                  <div className="loghint">
                    {player.name}'s {ww.opt.label.toLowerCase()} per game — {mateNames.length > 1 ? "all of " : ""}{mateLabel} in vs out (reference window).
                  </div>
                  <div className="ww-compare">
                    <div className="ww-box"><div className="big">{ww.withN ? fmt(ww.withAvg, 1) : "—"}</div><div className="lbl">With {mateNames.length > 1 ? "all" : mateLabel} ({ww.withN}g)</div></div>
                    <div className="ww-box"><div className="big">{ww.withoutN ? fmt(ww.withoutAvg, 1) : "—"}</div><div className="lbl">Without {mateNames.length > 1 ? "any" : ""} ({ww.withoutN}g)</div></div>
                  </div>
                  {mateIds.length > 1 && ww.mixedN > 0 && (
                    <div className="ww-excluded">{ww.mixedN} game{ww.mixedN === 1 ? "" : "s"} excluded (some in, some out).</div>
                  )}
                </>
              ) : <p className="empty">Select a teammate above.</p>}
            </>
          ) : <p className="empty">No teammates listed.</p>}
        </div>
      </div>
    </div>
  );
}

function PropResult({ prop, line }) {
  if (!prop.n) return <div className="prop-result"><p className="empty">No games match these filters.</p></div>;
  const Card = ({ cls, big, lbl }) => (
    <div className={`rstat ${cls}`}><div className="big">{big}</div><div className="lbl">{lbl}</div></div>
  );
  return (
    <div className="prop-result">
      {prop.hitRate != null && (
        <Card cls={prop.hitRate >= 0.5 ? "hit" : "miss"} big={`${Math.round(prop.hitRate * 100)}%`} lbl={`Over ${line} (${prop.overs}/${prop.n})`} />
      )}
      <Card cls="" big={fmt(prop.avg, 1)} lbl="Average" />
      <Card cls="" big={fmt(prop.med, 1)} lbl="Median" />
      {prop.l5overs != null && <Card cls="" big={`${prop.l5overs}/${prop.l5n}`} lbl="Last 5 over" />}
    </div>
  );
}

function PropLog({ prop, line }) {
  if (!prop.n) return null;
  const dec = prop.opt.dec;
  const hasLine = !Number.isNaN(line);
  return (
    <div>
      <div className="loghint">{prop.n} games match · ▲ over the line, ▼ under.</div>
      <table>
        <thead><tr><th>Game</th><th>Opp</th><th>H/A</th><th>{prop.opt.label}</th><th></th></tr></thead>
        <tbody>
          {prop.rows.map((l, i) => {
            const v = prop.vals[i];
            const hit = hasLine ? (v > line ? "over" : "under") : "";
            return (
              <tr key={i}>
                <td>{l.season} W{l.week}{l.div_game && <span className="pos-tag">div</span>}</td>
                <td>{l.opponent}</td>
                <td>{l.home === true ? "H" : l.home === false ? "A" : "—"}</td>
                <td>{fmt(v, dec)}</td>
                <td className={hit}>{hit ? (hit === "over" ? "▲" : "▼") : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

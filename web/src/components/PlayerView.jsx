import { useEffect, useMemo, useState } from "react";
import { fmt, pct, posClass, FLAG_TONE } from "../util.js";
import { STAT_OPTIONS, statOption, computeProp, computeWithWithout } from "../stats.js";

export default function PlayerView({ game, playerId, onSelectPlayer, onBack }) {
  // flat roster across both teams in display order (away then home) for the switcher
  const roster = useMemo(() => {
    const list = [];
    [game.away_team, game.home_team].forEach((tm) =>
      (game.teams[tm]?.usage || []).forEach((p) => list.push({ ...p, team: tm }))
    );
    return list;
  }, [game]);

  const idx = Math.max(0, roster.findIndex((r) => r.player_id === playerId));
  const player = roster[idx] || roster[0];
  const team = player.team;
  const opp = team === game.home_team ? game.away_team : game.home_team;
  const logs = game.player_logs[player.player_id] || [];
  const teammates = game.teams[team].usage.filter((p) => p.player_id !== player.player_id);

  const seasons = useMemo(() => [...new Set(logs.map((l) => l.season))].sort(), [logs]);
  const teamCounts = useMemo(() => {
    const c = {};
    logs.forEach((l) => { if (l.team) c[l.team] = (c[l.team] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [logs]);
  const multiTeam = teamCounts.length > 1;

  const defaultStat =
    player.position === "QB" ? "pass_yds" : player.position === "RB" ? "rush_yds" : "rec_yds";
  const [statKey, setStatKey] = useState(defaultStat);
  const [line, setLine] = useState(statOption(defaultStat).def);
  const [filters, setFilters] = useState({ season: "all", venue: "all", div: "all", opp: "all" });
  const [mateIds, setMateIds] = useState([]);
  const [wwStat, setWwStat] = useState(defaultStat);

  const toggleMate = (id) =>
    setMateIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const go = (delta) => onSelectPlayer(roster[(idx + delta + roster.length) % roster.length].player_id);

  // Esc → back; ←/→ → prev/next player (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "Escape") onBack();
      else if (!typing && e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (!typing && e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [idx, roster, onBack]);

  const onStatChange = (key) => { setStatKey(key); setLine(statOption(key).def); };

  const prop = useMemo(
    () => computeProp(logs, statKey, parseFloat(line), filters),
    [logs, statKey, line, filters]
  );
  const ww = useMemo(() => {
    if (!mateIds.length) return null;
    return computeWithWithout(logs, mateIds.map((id) => game.player_logs[id] || []), wwStat);
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
  const oppDef = game.teams[opp]?.defense?.[player.position];

  return (
    <div className="player-view">
      <div className="pv-nav">
        <button className="btn ghost" onClick={onBack}>← Back to game</button>
        <div className="pv-switch">
          <button className="pv-arrow" onClick={() => go(-1)} title="Previous player (←)" aria-label="Previous player">‹</button>
          <select className="pv-select" value={player.player_id} onChange={(e) => onSelectPlayer(e.target.value)}>
            {[game.away_team, game.home_team].map((tm) => (
              <optgroup key={tm} label={tm}>
                {game.teams[tm].usage.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {p.name} · {p.position}{p.status ? ` · ${p.status}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="pv-arrow" onClick={() => go(1)} title="Next player (→)" aria-label="Next player">›</button>
        </div>
      </div>

      <div className="pd-head">
        <h3>
          {player.name} <span className={`pos-tag ${posClass(player.position)}`}>{player.position}</span>
          {player.status && <span className={`flag ${FLAG_TONE[player.status] || "muted"}`}>{player.status}</span>}
        </h3>
        <div className="pd-sub">
          {team} · {logs.length} games on record (last season + this season) · this week vs {opp}
        </div>
      </div>

      {(player.status_note || multiTeam) && (
        <div className="pd-note">
          {player.status_note && <div>⚠ {player.status_note}</div>}
          {multiTeam && (
            <div>
              Played for multiple teams in this window:{" "}
              {teamCounts.map(([tm, n], i) => (
                <span key={tm}>{i ? " · " : ""}<b>{tm}</b> {n}g</span>
              ))}. Use the stat filters to isolate a stint.
            </div>
          )}
        </div>
      )}

      {/* quick context: this player's season usage + the opponent matchup */}
      <div className="pv-context">
        <StatStrip tiles={usageTiles(player)} />
        {oppDef && <MatchupCallout opp={opp} pos={player.position} d={oppDef} />}
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

      <div className="pv-cols">
        <div className="pv-main">
          <div className="section-label">Game log</div>
          <PropLog prop={prop} line={parseFloat(line)} showTeam={multiTeam} />
        </div>
        <div className="pv-side">
          <div className="section-label">With / without teammates</div>
          <WithWithout
            player={player}
            teammates={teammates}
            mateIds={mateIds}
            toggleMate={toggleMate}
            wwStat={wwStat}
            setWwStat={setWwStat}
            ww={ww}
            mateNames={mateNames}
            mateLabel={mateLabel}
          />
        </div>
      </div>
    </div>
  );
}

// Per-position season-usage tiles for the quick-context strip.
function usageTiles(p) {
  const t = [["Games", p.games], ["Snap%", pct(p.snap_pct)]];
  if (p.position === "QB") {
    t.push(["Pass yds/g", fmt(p.pass_yds_pg)], ["Pass TD", p.pass_tds],
           ["Car/g", fmt(p.carries_pg)], ["Rush yds/g", fmt(p.rush_yds_pg)]);
  } else if (p.position === "RB") {
    t.push(["Car/g", fmt(p.carries_pg)], ["Rush yds/g", fmt(p.rush_yds_pg)],
           ["Tgt/g", fmt(p.targets_pg)], ["Rec/g", fmt(p.receptions_pg)]);
  } else {
    t.push(["Tgt%", pct(p.target_share)], ["Tgt/g", fmt(p.targets_pg)],
           ["Rec/g", fmt(p.receptions_pg)], ["Rec yds/g", fmt(p.rec_yds_pg)]);
  }
  return t;
}

function StatStrip({ tiles }) {
  return (
    <div className="stat-strip">
      {tiles.map(([lbl, val]) => (
        <div className="tm" key={lbl}><div className="tm-big">{val}</div><div className="tm-lbl">{lbl}</div></div>
      ))}
    </div>
  );
}

function MatchupCallout({ opp, pos, d }) {
  const third = d.of_teams / 3;
  const tier = d.rank_most_allowed <= third ? "soft"
    : d.rank_most_allowed > 2 * third ? "tough" : "avg";
  const LABEL = { soft: "Soft", avg: "Average", tough: "Tough" };
  const NOTE = { soft: "favorable matchup", avg: "neutral matchup", tough: "tough matchup" };
  return (
    <div className={`matchup-callout ${tier}`}>
      <div className="mc-top">
        <span className="mc-lbl">This week vs {opp} defense</span>
        <span className={`matchup ${tier}`}>{LABEL[tier]}</span>
      </div>
      <div className="mc-stats">
        <span><b>{fmt(d.fantasy_pg_allowed)}</b> FP/g</span>
        <span><b>{fmt(d.yards_pg_allowed)}</b> yds/g</span>
        <span><b>{fmt(d.tds_pg_allowed, 2)}</b> TD/g</span>
        <span>rank <b>{d.rank_most_allowed}/{d.of_teams}</b></span>
      </div>
      <div className="mc-note">Allowed to {pos}s — {NOTE[tier]} (rank 1 = allows the most).</div>
    </div>
  );
}

function WithWithout({ player, teammates, mateIds, toggleMate, wwStat, setWwStat, ww, mateNames, mateLabel }) {
  if (!teammates.length) return <p className="empty">No teammates listed.</p>;
  const multi = mateNames.length > 1;
  return (
    <div className="ww-wrap">
      <div className="loghint">Toggle teammates in/out to see how {player.name}'s output shifts.</div>
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
            {player.name}'s {ww.opt.label.toLowerCase()} per game — {multi ? "all of " : ""}{mateLabel} in vs out.
          </div>
          <WwCompare ww={ww} mateLabel={mateLabel} multi={multi} />
          {multi && ww.mixedN > 0 && (
            <div className="ww-excluded">{ww.mixedN} game{ww.mixedN === 1 ? "" : "s"} excluded (some in, some out).</div>
          )}
        </>
      ) : <p className="empty">Select a teammate above.</p>}
    </div>
  );
}

function WwCompare({ ww, mateLabel, multi }) {
  const max = Math.max(ww.withAvg || 0, ww.withoutAvg || 0, 1);
  const diff = ww.withN && ww.withoutN ? ww.withAvg - ww.withoutAvg : null;
  const Bar = ({ avg, n, label, tone }) => (
    <div className="ww-row">
      <div className="ww-row-top">
        <span className="ww-lbl">{label}</span>
        <span className="ww-val">{n ? fmt(avg, 1) : "—"} <span className="muted">· {n}g</span></span>
      </div>
      <div className="ww-track">
        <div className={`ww-bar ${tone}`} style={{ width: `${n ? (avg / max) * 100 : 0}%` }} />
      </div>
    </div>
  );
  return (
    <div className="ww-compare">
      <Bar avg={ww.withAvg} n={ww.withN} tone="in" label={`With ${multi ? "all in" : mateLabel}`} />
      <Bar avg={ww.withoutAvg} n={ww.withoutN} tone="out" label={`Without ${multi ? "any" : mateLabel}`} />
      {diff != null && (
        <div className={`ww-delta ${diff >= 0 ? "up" : "down"}`}>
          {diff >= 0 ? "▲" : "▼"} {fmt(Math.abs(diff), 1)} per game {diff >= 0 ? "more" : "fewer"} with {multi ? "them" : mateLabel} in
        </div>
      )}
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

function PropLog({ prop, line, showTeam }) {
  if (!prop.n) return <p className="empty">No games match these filters.</p>;
  const dec = prop.opt.dec;
  const hasLine = !Number.isNaN(line);
  const maxVal = Math.max(line || 0, ...prop.vals, 1);
  const marginTxt = (v) => String(Math.round(Math.abs(v - line) * 10) / 10);

  return (
    <div>
      <div className="loghint">
        {prop.n} games match{hasLine ? " · each bar is that game vs the line (white marker) — green cleared it, red didn't" : ""}.
      </div>

      {hasLine && (
        <div className="ou-strip" title="Most recent games left → right">
          {prop.vals.map((v, i) => {
            const over = v > line;
            return (
              <span
                key={i}
                className={`ou-dot ${over ? "over" : "under"}`}
                title={`${prop.rows[i].season} W${prop.rows[i].week}: ${fmt(v, dec)} (${over ? "over" : "under"} ${line})`}
              >
                {over ? "O" : "U"}
              </span>
            );
          })}
        </div>
      )}

      <div className="table-wrap">
        <table className="oulog">
          <thead><tr><th>Game</th><th>Opp</th><th>H/A</th><th>{prop.opt.label}</th><th>± line</th><th></th></tr></thead>
          <tbody>
            {prop.rows.map((l, i) => {
              const v = prop.vals[i];
              const over = v > line;
              const cls = hasLine ? (over ? "over" : "under") : "";
              return (
                <tr key={i}>
                  <td>
                    {l.season} W{l.week}
                    {showTeam && l.team && <span className="pos-tag" title="player's team that game">{l.team}</span>}
                    {l.div_game && <span className="pos-tag">div</span>}
                  </td>
                  <td>{l.opponent}</td>
                  <td>{l.home === true ? "H" : l.home === false ? "A" : "—"}</td>
                  <td className={cls ? `val-${cls}` : ""}>{fmt(v, dec)}</td>
                  <td>
                    {hasLine && (
                      <span className={`ou-badge ${cls}`}>
                        {over ? "+" : "−"}{marginTxt(v)}
                      </span>
                    )}
                  </td>
                  <td className="ou-barcell">
                    <div className="ou-bar">
                      <div className={`ou-fill ${cls}`} style={{ width: `${(v / maxVal) * 100}%` }} />
                      {hasLine && <div className="ou-linemark" style={{ left: `${(line / maxVal) * 100}%` }} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

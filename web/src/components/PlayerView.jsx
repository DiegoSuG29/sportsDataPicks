import { useEffect, useMemo, useState } from "react";
import { fmt, posClass, FLAG_TONE } from "../util.js";
import { computeProp, computeWithWithout, gameKey, statVal } from "../stats.js";
import { statOption, statsForPosition, defaultStatFor } from "../sports.js";
import { matchupTier } from "./GameView.jsx";

// NFL logs are labeled by week, NBA logs by date.
const gameLabel = (l) => (l.week != null ? `${l.season} W${l.week}` : l.date);

export default function PlayerView({ cfg, game, playerId, onSelectPlayer, onBack }) {
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

  const availStats = useMemo(() => statsForPosition(cfg, player.position), [cfg, player.position]);
  const defaultStat = defaultStatFor(cfg, player.position);
  const [statKey, setStatKey] = useState(defaultStat);
  const [line, setLine] = useState(statOption(cfg, defaultStat).def);
  const [filters, setFilters] = useState({ season: "all", venue: "all", div: "all", opp: "all", avail: "0" });
  const [mateIds, setMateIds] = useState([]);

  const toggleMate = (id) =>
    setMateIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // land at the top whenever the page opens or the player changes (keyed remount)
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // The switcher only offers players with a chance to play (no IR/PUP/traded/…).
  const navList = useMemo(() => roster.filter((r) => !r.status), [roster]);
  const navIdx = navList.findIndex((r) => r.player_id === player.player_id);
  const go = (delta) => {
    if (!navList.length) return;
    const base = navIdx === -1 ? (delta > 0 ? -1 : 0) : navIdx;
    const n = (((base + delta) % navList.length) + navList.length) % navList.length;
    onSelectPlayer(navList[n].player_id);
  };

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
  }, [navIdx, navList, onBack]);

  const onStatChange = (key) => { setStatKey(key); setLine(statOption(cfg, key).def); };

  // When teammates are selected, scope the log/prop to games where NONE of them
  // played — i.e. the "without" projection — so the table hides mismatched games.
  const scopedLogs = useMemo(() => {
    if (!mateIds.length) return logs;
    const sets = mateIds.map((id) => new Set((game.player_logs[id] || []).map(gameKey)));
    return logs.filter((l) => sets.every((s) => !s.has(gameKey(l))));
  }, [logs, mateIds, game]);

  const opt = statOption(cfg, statKey);
  const prop = useMemo(
    () => computeProp(scopedLogs, opt, parseFloat(line), filters, cfg.availFilter),
    [scopedLogs, opt, line, filters, cfg]
  );
  // with/without tracks the same stat as the prop checker (the two are tied)
  const ww = useMemo(() => {
    if (!mateIds.length) return null;
    return computeWithWithout(logs, mateIds.map((id) => game.player_logs[id] || []), opt);
  }, [logs, mateIds, opt, game]);
  const mateNames = mateIds
    .map((id) => teammates.find((m) => m.player_id === id)?.name)
    .filter(Boolean);
  const mateLabel =
    mateNames.length === 0 ? "teammate"
    : mateNames.length === 1 ? mateNames[0]
    : mateNames.length === 2 ? mateNames.join(" & ")
    : `${mateNames.length} teammates`;

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const af = cfg.availFilter;
  const hasDiv = logs.some((l) => l.div_game != null); // NBA logs carry no division flag
  const slateWord = cfg.key === "nba" ? "tonight" : "this week";
  const oppDef = game.teams[opp]?.defense?.[cfg.bucket[player.position] || player.position];

  // teammates unavailable: NFL roster flag / injury Out-Doubtful; NBA recent DNP
  const outMateIds = useMemo(
    () => cfg.outTeammates(game.teams[team], teammates),
    [cfg, game, team, teammates]
  );
  const outIds = useMemo(() => new Set(outMateIds), [outMateIds]);

  return (
    <div className="player-view">
      <div className="pv-nav">
        <button className="btn ghost" onClick={onBack}>← Back to game</button>
        <div className="pv-switch">
          <button className="pv-arrow" onClick={() => go(-1)} title="Previous player (←)" aria-label="Previous player">‹</button>
          <select className="pv-select" value={player.player_id} onChange={(e) => onSelectPlayer(e.target.value)}>
            {[game.away_team, game.home_team].map((tm) => {
              // only playable players, plus the current one if it happens to be out
              const list = game.teams[tm].usage.filter((p) => !p.status || p.player_id === player.player_id);
              return (
                <optgroup key={tm} label={tm}>
                  {list.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      {p.name} · {p.position}{p.status ? ` · ${p.status}` : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
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
          {team} · {logs.length} games on record (last season + this season) · {slateWord} vs {opp}
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
        <StatStrip tiles={cfg.usageTiles(player)} />
        {oppDef && <MatchupCallout cfg={cfg} slateWord={slateWord} opp={opp} pos={player.position} d={oppDef} />}
      </div>

      <div className="section-label">Prop checker</div>
      <div className="prop-primary">
        <label className="pp-stat">Stat
          <select value={statKey} onChange={(e) => onStatChange(e.target.value)}>
            {availStats.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="pp-line">Line
          <StepControl
            min={opt.min} max={opt.max} step={opt.step}
            fallback={opt.def} value={line} onChange={setLine}
          />
        </label>
        <label className="pp-line">{af.label}
          <StepControl
            min={af.min} max={af.max} step={af.step} quantize={Math.round} suffix={af.suffix}
            value={filters.avail} onChange={(v) => setF("avail", v)}
          />
        </label>
      </div>
      <div className="prop-grid">
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
        {hasDiv && (
          <label>Division
            <select value={filters.div} onChange={(e) => setF("div", e.target.value)}>
              <option value="all">All</option><option value="div">Divisional</option><option value="nondiv">Non-div</option>
            </select>
          </label>
        )}
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
          {mateIds.length > 0 && (
            <div className="loghint">
              Filtered to games <b>without</b> the {mateIds.length} selected teammate{mateIds.length === 1 ? "" : "s"} —
              showing {scopedLogs.length} of {logs.length}.
            </div>
          )}
          <PropLog cfg={cfg} prop={prop} line={parseFloat(line)} showTeam={multiTeam} />
        </div>
        <div className="pv-side">
          <div className="section-label">With / without teammates</div>
          <WithWithout
            player={player}
            teammates={teammates}
            mateIds={mateIds}
            toggleMate={toggleMate}
            outIds={outIds}
            outWord={cfg.key === "nba" ? "sat recently (DNP)" : "out this week"}
            onAutoOut={() => setMateIds([...outMateIds])}
            onClear={() => setMateIds([])}
            statKey={statKey}
            onStatChange={onStatChange}
            availStats={availStats}
            ww={ww}
            mateNames={mateNames}
            mateLabel={mateLabel}
          />
        </div>
      </div>

      {cfg.similar && game.teams[opp]?.faced && (
        <SimilarPlayers
          cfg={cfg}
          player={player}
          opp={opp}
          faced={game.teams[opp].faced}
          opt={opt}
          line={parseFloat(line)}
        />
      )}
    </div>
  );
}

// Same-position players who faced this opponent this season, filtered to a
// comparable role (snap% ≥ the player's average minus a cushion).
function SimilarPlayers({ cfg, player, opp, faced, opt, line }) {
  const af = cfg.availFilter;
  const base = cfg.similar.base(player);
  const [useFilter, setUseFilter] = useState(base != null);
  const [minAvail, setMinAvail] = useState(
    base != null ? String(Math.max(af.min, base - cfg.similar.cushion)) : "0"
  );
  const bucket = cfg.bucket[player.position] || player.position;
  const hasLine = !Number.isNaN(line);

  const rows = useMemo(() => {
    const thr = Number(minAvail);
    return faced
      .filter((r) => r.bucket === bucket)
      .filter((r) => {
        if (!useFilter) return true;
        const v = r[af.field];
        return v != null && v * (af.scale || 1) >= thr;
      })
      .map((r) => ({ ...r, val: statVal(opt, r) }))
      .sort((a, b) => b.week - a.week || b.val - a.val);
  }, [faced, bucket, useFilter, minAvail, opt, af]);

  const n = rows.length;
  const overs = hasLine ? rows.filter((r) => r.val > line).length : null;
  const avg = n ? rows.reduce((s, r) => s + r.val, 0) / n : null;
  const games = new Set(rows.map((r) => r.week)).size;
  const maxVal = Math.max(line || 0, ...rows.map((r) => r.val), 1);
  const dec = opt.dec;
  const posLabel = (cfg.posName[bucket] || `${bucket}s`).toLowerCase();

  return (
    <div className="similar">
      <div className="section-label">Similar players vs {opp}</div>
      <div className="loghint">
        Other {posLabel} against the {opp} defense this season, with the prop checker's stat and line.
        {base != null && <> {player.name} averages <b>{cfg.similar.baseText(base)}</b>; default cutoff is {cfg.similar.cushion} below that.</>}
      </div>
      <div className="sim-controls">
        <label className="sim-check">
          <input type="checkbox" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} />
          Only similar roles ({af.label.toLowerCase()} filter)
        </label>
        {useFilter && (
          <label className="pp-line sim-thr">{af.label}
            <StepControl
              min={af.min} max={af.max} step={af.step} quantize={Math.round} suffix={af.suffix}
              value={minAvail} onChange={setMinAvail}
            />
          </label>
        )}
      </div>

      {!n ? (
        <p className="empty">No {posLabel} vs {opp} match{useFilter ? " this snap% threshold" : ""}.</p>
      ) : (
        <>
          <div className="prop-result">
            {hasLine && (
              <div className={`rstat ${overs / n >= 0.5 ? "hit" : "miss"}`}>
                <div className="big">{Math.round((overs / n) * 100)}%</div>
                <div className="lbl">Over {line} ({overs}/{n})</div>
              </div>
            )}
            <div className="rstat"><div className="big">{fmt(avg, 1)}</div><div className="lbl">Average</div></div>
            <div className="rstat"><div className="big">{n}</div><div className="lbl">Player-games ({games} games)</div></div>
          </div>
          <div className="table-wrap">
            <table className="oulog">
              <thead>
                <tr><th>Player</th><th>Wk</th><th>{cfg.logAvailCol.label}</th><th>{opt.label}</th><th>± line</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const over = r.val > line;
                  const cls = hasLine ? (over ? "over" : "under") : "";
                  const self = r.player_id === player.player_id;
                  return (
                    <tr key={`${r.player_id}-${r.week}`} className={self ? "sim-self" : ""}>
                      <td>
                        {r.name} <span className="pos-tag" title="team that game">{r.team}</span>
                        {self && <span className="muted"> (this player)</span>}
                      </td>
                      <td>{gameLabel(r)}</td>
                      <td className="muted">{cfg.logAvailCol.fn(r)}</td>
                      <td className={cls ? `val-${cls}` : ""}>{fmt(r.val, dec)}</td>
                      <td>
                        {hasLine && (
                          <span className={`ou-badge ${cls}`}>
                            {over ? "+" : "−"}{Math.round(Math.abs(r.val - line) * 10) / 10}
                          </span>
                        )}
                      </td>
                      <td className="ou-barcell">
                        <div className="ou-bar">
                          <div className={`ou-fill ${cls}`} style={{ width: `${(r.val / maxVal) * 100}%` }} />
                          {hasLine && <div className="ou-linemark" style={{ left: `${(line / maxVal) * 100}%` }} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
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

// Three-way control: type, slide, or step with +/- buttons (one step at a time).
// Used for the prop line and the min-snap% threshold; bounds adapt per use.
function StepControl({ min, max, step, quantize, suffix, fallback, value, onChange }) {
  const q = quantize || ((v) => Math.round(v * 2) / 2); // default keeps half-point lines
  const num = parseFloat(value);
  const base = Number.isNaN(num) ? (fallback ?? min) : num;
  const clamp = (v) => Math.min(max, Math.max(min, q(v)));
  const bump = (dir) => onChange(String(clamp(base + dir * step)));
  const edge = (v) => `${v}${suffix || ""}`;
  return (
    <div className="line-input">
      <div className="li-row">
        <button type="button" className="li-btn" onClick={() => bump(-1)} aria-label={`−${step}`}>−</button>
        <input className="li-num" type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="li-btn" onClick={() => bump(1)} aria-label={`+${step}`}>+</button>
      </div>
      <input
        className="li-range" type="range"
        min={min} max={max} step={step}
        value={clamp(base)} onChange={(e) => onChange(e.target.value)}
      />
      <div className="li-scale"><span>{edge(min)}</span><span className="li-step">±{step}</span><span>{edge(max)}</span></div>
    </div>
  );
}

function MatchupCallout({ cfg, slateWord, opp, pos, d }) {
  const tier = matchupTier(d);
  const LABEL = { soft: "Soft", avg: "Average", tough: "Tough" };
  const NOTE = { soft: "favorable matchup", avg: "neutral matchup", tough: "tough matchup" };
  return (
    <div className={`matchup-callout ${tier}`}>
      <div className="mc-top">
        <span className="mc-lbl">{slateWord[0].toUpperCase() + slateWord.slice(1)} vs {opp} defense</span>
        <span className={`matchup ${tier}`}>{LABEL[tier]}</span>
      </div>
      <div className="mc-stats">
        {cfg.matchupStats(d).map(([lbl, val]) => <span key={lbl}><b>{val}</b> {lbl}</span>)}
        <span>rank <b>{d.rank_most_allowed}/{d.of_teams}</b></span>
      </div>
      <div className="mc-note">Allowed to {pos}s — {NOTE[tier]} (rank 1 = allows the most).</div>
    </div>
  );
}

function WithWithout({ player, teammates, mateIds, toggleMate, outIds, outWord, onAutoOut, onClear, statKey, onStatChange, availStats, ww, mateNames, mateLabel }) {
  if (!teammates.length) return <p className="empty">No teammates listed.</p>;
  const multi = mateNames.length > 1;
  const outCount = outIds?.size || 0;
  return (
    <div className="ww-wrap">
      <div className="loghint">Toggle teammates in/out to see how {player.name}'s output shifts.</div>
      <div className="ww-actions">
        {outCount > 0 && (
          <button className="btn ghost sm" onClick={onAutoOut}>
            Match absences ({outCount})
          </button>
        )}
        {mateIds.length > 0 && (
          <button className="btn ghost sm" onClick={onClear}>Clear</button>
        )}
      </div>
      <div className="ww-mates">
        {teammates.map((m) => {
          const on = mateIds.includes(m.player_id);
          const isOut = outIds?.has(m.player_id);
          return (
            <button
              key={m.player_id}
              className={`ww-chip ${on ? "on" : ""} ${isOut ? "out" : ""}`}
              onClick={() => toggleMate(m.player_id)}
              title={isOut ? outWord : undefined}
            >
              <span className={`pos-tag ${posClass(m.position)}`}>{m.position}</span> {m.name}
              {isOut && <span className="ww-outdot" title={outWord}>●</span>}
              <span className="pm">{on ? "−" : "+"}</span>
            </button>
          );
        })}
      </div>
      {outCount > 0 && (
        <div className="loghint">
          "Match absences" selects the {outCount} teammate{outCount === 1 ? "" : "s"} who {outWord === "out this week" ? "are out this week" : "sat recently (DNP)"} —
          the <b>Without</b> figure then projects {player.name} with them sidelined.
        </div>
      )}
      <div className="prop-grid">
        <label>Stat (shared with the prop checker)
          <select value={statKey} onChange={(e) => onStatChange(e.target.value)}>
            {availStats.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
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
  // framed around absence: positive = the player does MORE with them out (good).
  const outDiff = ww.withN && ww.withoutN ? ww.withoutAvg - ww.withAvg : null;
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
      <Bar avg={ww.withoutAvg} n={ww.withoutN} tone="out" label={`Without ${multi ? "any" : mateLabel}`} />
      <Bar avg={ww.withAvg} n={ww.withN} tone="in" label={`With ${multi ? "all in" : mateLabel}`} />
      {outDiff != null && (
        <div className={`ww-delta ${outDiff >= 0 ? "up" : "down"}`}>
          {outDiff >= 0 ? "▲" : "▼"} {fmt(Math.abs(outDiff), 1)} per game {outDiff >= 0 ? "more" : "fewer"} with {multi ? "them" : mateLabel} out
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

function PropLog({ cfg, prop, line, showTeam }) {
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
        <div className="ou-strip" title="Newest game on the left → oldest on the right">
          {prop.vals.map((v, i) => {
            const over = v > line;
            return (
              <span
                key={i}
                className={`ou-dot ${over ? "over" : "under"}`}
                title={`${gameLabel(prop.rows[i])}:${fmt(v, dec)} (${over ? "over" : "under"} ${line})`}
              >
                {over ? "O" : "U"}
              </span>
            );
          })}
        </div>
      )}

      <div className="table-wrap">
        <table className="oulog">
          <thead><tr><th>Game</th><th>Opp</th><th>H/A</th><th>{cfg.logAvailCol.label}</th><th>{prop.opt.label}</th><th>± line</th><th></th></tr></thead>
          <tbody>
            {prop.rows.map((l, i) => {
              const v = prop.vals[i];
              const over = v > line;
              const cls = hasLine ? (over ? "over" : "under") : "";
              return (
                <tr key={i}>
                  <td>
                    {gameLabel(l)}
                    {showTeam && l.team && <span className="pos-tag" title="player's team that game">{l.team}</span>}
                    {l.div_game && <span className="pos-tag">div</span>}
                  </td>
                  <td>{l.opponent}</td>
                  <td>{l.home === true ? "H" : l.home === false ? "A" : "—"}</td>
                  <td className="muted">{cfg.logAvailCol.fn(l)}</td>
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

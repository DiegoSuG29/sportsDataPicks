import { useState } from "react";
import { posClass } from "../util.js";
import { Team } from "../logos.jsx";

// League-wide soft spots: the defenses that allow the most per position, among
// teams playing on this slate. The listed opponent is the offense to target.
// NBA adds stat tabs (byStat = index.json worst_by_stat, pace-adjusted ranks).
export default function WorstDefenses({ cfg, data, byStat, onOpen }) {
  const tabs = byStat && cfg.worstStats ? cfg.worstStats : null;
  const [stat, setStat] = useState("fp");
  const label = tabs?.find((t) => t[0] === stat)?.[1] || "FP";
  const rows = tabs ? byStat[stat] || {} : data;
  return (
    <section className="worst-def">
      <div className="wd-title">
        <h2>Worst defenses by position</h2>
        <span className="muted">
          Top 5 soft spots on this slate{tabs ? " · ranked per 100 possessions" : ""} · the opponent is the offense to target
        </span>
        {tabs && (
          <div className="team-toggle wd-tabs" role="tablist">
            {tabs.map(([k, l]) => (
              <button key={k} className={`tt-btn ${k === stat ? "active" : ""}`} onClick={() => setStat(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div className="wd-grid">
        {cfg.positions.map((pos) => (
          <div className={`wd-col ${posClass(pos)}`} key={pos}>
            <div className="wd-head">{cfg.posName[pos]}</div>
            <ol className="wd-list">
              {(rows[pos] || []).map((r) => (
                <li className="wd-row" key={r.team} onClick={() => onOpen(r.game_file)}
                    title={r.p100 != null ? `${r.p100} ${label} per 100 poss · ${r.vs_avg > 0 ? "+" : ""}${Math.round(r.vs_avg * 100)}% vs avg` : undefined}>
                  <span className="wd-rank">#{r.rank}</span>
                  <span className="wd-team"><Team abbr={r.team} size={18} /></span>
                  <span className="wd-fp">{r.pg ?? r.fantasy_pg_allowed}<span className="wd-u"> {label}/g</span></span>
                  <span className="wd-opp">{r.home ? "vs" : "@"} <b><Team abbr={r.opponent} size={14} /></b></span>
                </li>
              ))}
              {!(rows[pos] || []).length && <li className="empty">No data.</li>}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

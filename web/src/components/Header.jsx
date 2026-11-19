import { SPORTS } from "../sports.js";

export default function Header({ cfg, sport, onSportChange, slates, slateFile, onSlateChange, actionsUrl }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">{cfg.logo}</span>
        <div>
          <h1>Picks Dashboard</h1>
          <p className="tagline">{cfg.tagline}</p>
        </div>
      </div>
      <div className="controls">
        <div className="team-toggle sport-toggle" role="tablist" aria-label="Sport">
          {Object.values(SPORTS).map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={s.key === sport}
              className={`tt-btn ${s.key === sport ? "active" : ""}`}
              onClick={() => s.key !== sport && onSportChange(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="week-select">
          {cfg.slateSelectLabel}
          <select value={slateFile || ""} onChange={(e) => onSlateChange(e.target.value)}>
            {slates.slice().reverse().map((s) => (
              <option key={s.file} value={s.file}>{cfg.slateOptionLabel(s)}</option>
            ))}
          </select>
        </label>
        <a className="btn" href={actionsUrl} target="_blank" rel="noopener"
           title="Open GitHub Actions to refresh the data">↻ Refresh</a>
      </div>
    </header>
  );
}

export default function Header({ weeks, weekFile, onWeekChange, actionsUrl }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">🏈</span>
        <div>
          <h1>Picks Dashboard</h1>
          <p className="tagline">Data-driven NFL edges — all judgments come from official data.</p>
        </div>
      </div>
      <div className="controls">
        <label className="week-select">
          Week
          <select value={weekFile || ""} onChange={(e) => onWeekChange(e.target.value)}>
            {weeks.slice().reverse().map((w) => (
              <option key={w.file} value={w.file}>
                {w.label} ({w.season})
              </option>
            ))}
          </select>
        </label>
        <a className="btn" href={actionsUrl} target="_blank" rel="noopener"
           title="Open GitHub Actions to refresh the data">↻ Refresh</a>
      </div>
    </header>
  );
}

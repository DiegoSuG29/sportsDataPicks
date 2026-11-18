# Picks Dashboard

Data-driven NFL (later NBA) picks dashboard. GitHub Actions pulls open data,
computes situational splits and flags edges, then commits JSON. GitHub Pages
serves a static dashboard that reads that JSON. **No betting sites or picks
articles are used as inputs — all judgments come from data.**

See [CLAUDE.md](CLAUDE.md) for the full project brief and methodology.

## Layout
```
nfl/pipeline.py              # nflreadpy -> per-game JSON
data/nfl/week_XX/*.json      # pipeline output (one file per game + index.json)
data/nfl/manifest.json       # list of available weeks (dashboard reads this)
web/                         # static dashboard source (vanilla now; React-ready)
.github/workflows/pages.yml  # bundles web/ + data/ and deploys to GitHub Pages
```

GitHub Pages is served via **GitHub Actions** (Settings → Pages → Source:
GitHub Actions). The deploy workflow copies `web/` to the site root and `data/`
to `/data`, so the dashboard fetches its JSON same-origin at `data/nfl/...`.
To move the frontend to React later, point a build (e.g. Vite with
`base: '/sportsDataPicks/'`) at `web/` and have the workflow deploy its output
instead — the data layout stays the same.

## Running the NFL pipeline locally
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r requirements.txt

python nfl/pipeline.py --season 2026 --week 11
```
Omit `--week` to auto-detect the current week; omit `--season` to use the
current NFL season. Output lands in `data/nfl/week_XX/`.

Each game JSON contains: game meta + spread/total, per-team form (with
home/away and divisional splits), defense-allowed-by-position (with league
rank), usage shares (targets/carries/snaps), the current injury report, full
per-game player logs for the browser prop checker, and transparent edge flags.

Reference window is **last season + current season only**.

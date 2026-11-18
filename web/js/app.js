/* Picks Dashboard — NFL
 * Static, dependency-free. Reads the JSON the pipeline commits under
 * docs/data/nfl/ (same origin). All numbers come from that data; this file
 * only presents them and runs the browser-side prop / with-without math.
 */

const CONFIG = {
  dataBase: "data/nfl",
  // Refresh points at GitHub Actions. Once the NFL workflow exists (build
  // step 3) swap this for its ".../actions/workflows/nfl.yml" dispatch page.
  actionsUrl: "https://github.com/DiegoSuG29/sportsDataPicks/actions",
};

const STAT_OPTIONS = [
  { key: "rec_yds", label: "Receiving yards", def: 40.5 },
  { key: "receptions", label: "Receptions", def: 3.5 },
  { key: "targets", label: "Targets", def: 5.5 },
  { key: "rush_yds", label: "Rushing yards", def: 40.5 },
  { key: "carries", label: "Rush attempts", def: 10.5 },
  { key: "scrim_yds", label: "Rush + Rec yards", def: 60.5, compute: (r) => r.rush_yds + r.rec_yds },
  { key: "pass_yds", label: "Passing yards", def: 224.5 },
  { key: "pass_tds", label: "Passing TDs", def: 1.5 },
  { key: "anytime_td", label: "Anytime TD", def: 0.5, compute: (r) => r.rush_tds + r.rec_tds },
];

const state = {
  manifest: null,
  week: null, // current week index.json contents
  game: null, // current game JSON
};

// ------------------------------------------------------------------ utils
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : (+v).toFixed(d));
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function spreadText(game) {
  const s = game.spread_line;
  if (s == null) return "—";
  if (s === 0) return "Pick'em";
  return s > 0 ? `${game.home_team} -${s}` : `${game.away_team} -${Math.abs(s)}`;
}

// ------------------------------------------------------------------ boot
async function init() {
  $("#refresh-link").href = CONFIG.actionsUrl;
  $("#back-btn").addEventListener("click", showGameList);
  $("#modal-close").addEventListener("click", closeModal);
  $("#player-modal").addEventListener("click", (e) => {
    if (e.target.id === "player-modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  $("#week-select").addEventListener("change", (e) => loadWeek(e.target.value));

  try {
    state.manifest = await getJSON(`${CONFIG.dataBase}/manifest.json`);
  } catch (err) {
    $("#game-list").innerHTML =
      `<p class="empty">No data yet. Run the pipeline to generate week JSON.<br><small>${esc(err.message)}</small></p>`;
    return;
  }

  const sel = $("#week-select");
  state.manifest.weeks
    .slice()
    .reverse()
    .forEach((w) => {
      const o = el("option");
      o.value = w.file;
      o.textContent = `${w.label} (${w.season})`;
      sel.appendChild(o);
    });

  const latest = state.manifest.latest;
  if (latest) {
    sel.value = latest.file;
    await loadWeek(latest.file);
  }
}

async function loadWeek(file) {
  const week = await getJSON(`${CONFIG.dataBase}/${file}`);
  state.week = week;
  const gen = week.generated_at ? new Date(week.generated_at).toLocaleString() : "unknown";
  $("#data-stamp").textContent =
    `Season ${week.season} · ${week.games.length} games · stats through Week ${week.stats_through_week} · data generated ${gen}`;
  renderGameList(week);
  showGameList();
}

// ------------------------------------------------------------------ game list
function renderGameList(week) {
  const list = $("#game-list");
  list.innerHTML = "";
  week.games.forEach((g) => {
    const card = el("div", "game-card");
    card.innerHTML = `
      <div class="matchup">${g.away_team} <span class="muted">@</span> ${g.home_team}</div>
      <div class="gc-meta">${esc(g.weekday)} · ${esc(g.gameday)}</div>
      <div class="gc-line">
        <span>Spread <b>${esc(spreadText(g))}</b></span>
        <span>Total <b>${fmt(g.total_line)}</b></span>
      </div>`;
    card.addEventListener("click", () => openGame(g.file));
    list.appendChild(card);
  });
}

function showGameList() {
  $("#game-view").classList.add("hidden");
  $("#games-view").classList.remove("hidden");
}

// ------------------------------------------------------------------ game view
async function openGame(file) {
  const game = await getJSON(`${CONFIG.dataBase}/${file}`);
  state.game = game;
  renderGame(game);
  $("#games-view").classList.add("hidden");
  $("#game-view").classList.remove("hidden");
  window.scrollTo(0, 0);
}

function renderGame(game) {
  const root = $("#game-detail");
  root.innerHTML = "";

  const head = el("div");
  head.innerHTML = `
    <div class="game-head">
      <h2>${game.away_team} @ ${game.home_team}</h2>
      <span class="sub">${esc(game.weekday)} · ${esc(game.gameday)}${game.gametime ? " · " + esc(game.gametime) : ""}</span>
      ${game.div_game ? '<span class="pill div">Divisional</span>' : ""}
    </div>
    <div class="line-row">
      <div class="box"><span>Spread </span><b>${esc(spreadText(game))}</b></div>
      <div class="box"><span>Total </span><b>${fmt(game.total_line)}</b></div>
      <div class="box"><span>Roof </span><b>${esc(game.roof || "—")}</b></div>
      <div class="box"><span>Surface </span><b>${esc(game.surface || "—")}</b></div>
    </div>`;
  root.appendChild(head);

  root.appendChild(renderEdges(game.edges));

  const teams = el("div", "teams");
  teams.appendChild(renderTeam(game, game.away_team, "Away"));
  teams.appendChild(renderTeam(game, game.home_team, "Home"));
  root.appendChild(teams);
}

function renderEdges(edges) {
  const box = el("div", "edges");
  box.appendChild(el("h3", null, `Flagged edges ${edges.length ? `(${edges.length})` : ""}`));
  if (!edges.length) {
    box.appendChild(el("p", "empty", "No edges flagged from the data for this game."));
    return box;
  }
  edges.forEach((e) => {
    const row = el("div", "edge");
    row.innerHTML = `
      <span class="tag ${esc(e.type)}">${esc(e.type)}</span>
      <div>
        <div class="etext">${esc(e.text)}</div>
        ${e.stat ? `<div class="estat">${esc(e.stat)}</div>` : ""}
      </div>`;
    box.appendChild(row);
  });
  return box;
}

function renderTeam(game, team, venue) {
  const t = game.teams[team];
  const panel = el("div", "team-panel");
  const f = t.form;

  panel.appendChild(el("h3", null, `${team} <span class="muted" style="font-size:14px">(${venue})</span>`));
  panel.appendChild(el("div", "rec", `${esc(f.record)} · ${fmt(f.ppg)} PPG · ${fmt(f.papg)} allowed`));

  // form / splits
  panel.appendChild(el("div", "section-label", "Form"));
  const last5 = el("div", "last5");
  (f.last5 || []).forEach((g) => {
    const r = g[0];
    last5.appendChild(el("span", `g-chip ${r}`, esc(g)));
  });
  if (!f.last5 || !f.last5.length) last5.appendChild(el("span", "empty", "no games yet"));
  panel.appendChild(last5);

  const ha = f.home_away_split, dv = f.div_split;
  const splits = el("div");
  splits.style.marginTop = "8px";
  splits.innerHTML = `
    <div class="statline"><span class="k">Home</span> ${splitTxt(ha.home)} &nbsp; <span class="k">Away</span> ${splitTxt(ha.away)}</div>
    <div class="statline"><span class="k">Div</span> ${splitTxt(dv.divisional)} &nbsp; <span class="k">Non-div</span> ${splitTxt(dv.non_divisional)}</div>`;
  panel.appendChild(splits);

  // defense allowed by position
  panel.appendChild(el("div", "section-label", "Defense allowed by position (per game)"));
  panel.appendChild(defenseTable(t.defense));

  // usage
  panel.appendChild(el("div", "section-label", "Usage — click a player for props & splits"));
  panel.appendChild(usageTable(game, team, t.usage));

  // injuries
  panel.appendChild(el("div", "section-label", "Injury report"));
  panel.appendChild(injuryList(t.injuries));

  return panel;
}

function splitTxt(s) {
  if (!s || !s.games) return `<span class="muted">—</span>`;
  return `<b>${fmt(s.ppg)}</b>/<b>${fmt(s.papg)}</b> <span class="muted">(${s.games}g)</span>`;
}

function defenseTable(def) {
  const order = ["QB", "RB", "WR", "TE"];
  const tbl = el("table");
  tbl.innerHTML = `<thead><tr><th>Pos</th><th>FP/g</th><th>Yds/g</th><th>TD/g</th><th>Rank</th></tr></thead>`;
  const tb = el("tbody");
  order.forEach((pos) => {
    const d = def[pos];
    if (!d) return;
    // rank 1 = allows MOST (worst defense / best for offense)
    const rankCls = d.rank_most_allowed <= 8 ? "rank-bad" : d.rank_most_allowed >= d.of_teams - 7 ? "rank-good" : "";
    const tr = el("tr");
    tr.innerHTML = `
      <td>${pos}</td>
      <td>${fmt(d.fantasy_pg_allowed)}</td>
      <td>${fmt(d.yards_pg_allowed)}</td>
      <td>${fmt(d.tds_pg_allowed, 2)}</td>
      <td class="${rankCls}">${d.rank_most_allowed}/${d.of_teams}</td>`;
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  const note = el("div", "loghint", "Rank 1 = allows the most (softest matchup).");
  const wrap = el("div");
  wrap.appendChild(tbl);
  wrap.appendChild(note);
  return wrap;
}

function usageTable(game, team, usage) {
  const tbl = el("table");
  tbl.innerHTML = `<thead><tr><th>Player</th><th>Snap%</th><th>Tgt%</th><th>Tgt/g</th><th>Rec/g</th><th>Car/g</th><th>TD</th></tr></thead>`;
  const tb = el("tbody");
  if (!usage.length) tb.appendChild(el("tr", null, `<td colspan="7" class="empty">No usage data.</td>`));
  usage.forEach((p) => {
    const tr = el("tr", "clickable");
    tr.innerHTML = `
      <td>${esc(p.name)}<span class="pos-tag">${esc(p.position)}</span></td>
      <td>${pct(p.snap_pct)}</td>
      <td>${pct(p.target_share)}</td>
      <td>${fmt(p.targets_pg)}</td>
      <td>${fmt(p.receptions_pg)}</td>
      <td>${fmt(p.carries_pg)}</td>
      <td>${p.total_tds}</td>`;
    tr.addEventListener("click", () => openPlayer(game, team, p));
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  return tbl;
}

function injuryList(injuries) {
  const wrap = el("div");
  if (!injuries.length) {
    wrap.appendChild(el("p", "empty", "No injuries reported."));
    return wrap;
  }
  injuries.forEach((i) => {
    const row = el("div", "inj-row");
    const missed = i.games_missed != null ? ` · ${i.games_missed} missed` : "";
    row.innerHTML = `
      <span>${esc(i.name)} <span class="pos-tag">${esc(i.position)}</span>
        <span class="muted">${esc(i.injury || "")}${missed}</span></span>
      <span class="status ${esc(i.report_status || "")}">${esc(i.report_status || i.practice_status || "—")}</span>`;
    wrap.appendChild(row);
  });
  return wrap;
}

// ------------------------------------------------------------------ player modal
function openPlayer(game, team, player) {
  const logs = (game.player_logs[player.player_id] || []).slice();
  const opp = team === game.home_team ? game.away_team : game.home_team;
  const teammates = game.teams[team].usage.filter((p) => p.player_id !== player.player_id);

  const root = $("#player-detail");
  root.innerHTML = `
    <div class="pd-head">
      <h3>${esc(player.name)} <span class="pos-tag">${esc(player.position)}</span></h3>
      <div class="pd-sub">${esc(team)} · ${logs.length} games on record (last season + this season) · this week vs ${esc(opp)}</div>
    </div>
    <div class="section-label">Prop checker</div>
    <div class="prop-grid">
      <label>Stat<select id="pc-stat"></select></label>
      <label>Line<input id="pc-line" type="number" step="0.5" /></label>
      <label>Season<select id="pc-season"><option value="all">All</option></select></label>
      <label>Venue<select id="pc-venue">
        <option value="all">All</option><option value="home">Home</option><option value="away">Away</option></select></label>
      <label>Division<select id="pc-div">
        <option value="all">All</option><option value="div">Divisional</option><option value="nondiv">Non-div</option></select></label>
      <label>Opponent<select id="pc-opp">
        <option value="all">All</option><option value="${esc(opp)}">vs ${esc(opp)}</option></select></label>
    </div>
    <div id="pc-result" class="prop-result"></div>
    <div id="pc-log"></div>

    <div class="section-label">With / without a teammate</div>
    <div class="ww-wrap">
      <div class="prop-grid">
        <label>Teammate<select id="ww-mate"></select></label>
        <label>Stat<select id="ww-stat"></select></label>
      </div>
      <div id="ww-result"></div>
    </div>`;

  // populate stat selects
  const statSel = $("#pc-stat"), wwStatSel = $("#ww-stat");
  STAT_OPTIONS.forEach((o) => {
    statSel.appendChild(new Option(o.label, o.key));
    wwStatSel.appendChild(new Option(o.label, o.key));
  });
  // seasons present
  const seasons = [...new Set(logs.map((l) => l.season))].sort();
  seasons.forEach((s) => $("#pc-season").appendChild(new Option(s, s)));
  // teammates
  teammates.forEach((m) =>
    $("#ww-mate").appendChild(new Option(`${m.name} (${m.position})`, m.player_id))
  );

  // sensible default stat by position
  const defaultStat =
    player.position === "QB" ? "pass_yds" : player.position === "RB" ? "rush_yds" : "rec_yds";
  statSel.value = defaultStat;
  wwStatSel.value = defaultStat;
  $("#pc-line").value = STAT_OPTIONS.find((o) => o.key === defaultStat).def;

  const recompute = () => runPropChecker(logs);
  ["pc-stat", "pc-line", "pc-season", "pc-venue", "pc-div", "pc-opp"].forEach((id) =>
    $("#" + id).addEventListener("input", recompute)
  );
  statSel.addEventListener("change", () => {
    $("#pc-line").value = STAT_OPTIONS.find((o) => o.key === statSel.value).def;
    recompute();
  });

  const recomputeWW = () => runWithWithout(game, team, player, logs);
  $("#ww-mate").addEventListener("change", recomputeWW);
  wwStatSel.addEventListener("change", recomputeWW);

  recompute();
  recomputeWW();

  $("#player-modal").classList.remove("hidden");
}

function closeModal() {
  $("#player-modal").classList.add("hidden");
}

function statVal(opt, row) {
  return opt.compute ? opt.compute(row) : row[opt.key] ?? 0;
}

function filterLogs(logs) {
  const season = $("#pc-season").value;
  const venue = $("#pc-venue").value;
  const div = $("#pc-div").value;
  const opp = $("#pc-opp").value;
  return logs.filter((l) => {
    if (season !== "all" && String(l.season) !== season) return false;
    if (venue === "home" && l.home !== true) return false;
    if (venue === "away" && l.home !== false) return false;
    if (div === "div" && !l.div_game) return false;
    if (div === "nondiv" && l.div_game) return false;
    if (opp !== "all" && l.opponent !== opp) return false;
    return true;
  });
}

function runPropChecker(allLogs) {
  const opt = STAT_OPTIONS.find((o) => o.key === $("#pc-stat").value);
  const line = parseFloat($("#pc-line").value);
  const logs = filterLogs(allLogs).sort((a, b) => a.season - b.season || a.week - b.week);
  const vals = logs.map((l) => statVal(opt, l));
  const n = vals.length;

  const res = $("#pc-result");
  res.innerHTML = "";
  if (!n) {
    res.innerHTML = `<p class="empty">No games match these filters.</p>`;
    $("#pc-log").innerHTML = "";
    return;
  }

  const overs = Number.isNaN(line) ? 0 : vals.filter((v) => v > line).length;
  const hitRate = Number.isNaN(line) ? null : overs / n;
  const avg = vals.reduce((a, b) => a + b, 0) / n;
  const sorted = vals.slice().sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const l5 = vals.slice(-5);
  const l5overs = Number.isNaN(line) ? null : l5.filter((v) => v > line).length;

  const card = (cls, big, lbl) => `<div class="rstat ${cls}"><div class="big">${big}</div><div class="lbl">${lbl}</div></div>`;
  res.innerHTML =
    (hitRate != null ? card(hitRate >= 0.5 ? "hit" : "miss", pct(hitRate), `Over ${line} (${overs}/${n})`) : "") +
    card("", fmt(avg, 1), "Average") +
    card("", fmt(med, 1), "Median") +
    (l5overs != null ? card("", `${l5overs}/${l5.length}`, "Last 5 over") : "");

  // per-game log
  const tbl = el("table");
  tbl.innerHTML = `<thead><tr><th>Game</th><th>Opp</th><th>H/A</th><th>${esc(opt.label)}</th><th></th></tr></thead>`;
  const tb = el("tbody");
  logs.forEach((l, i) => {
    const v = vals[i];
    const hit = !Number.isNaN(line) ? (v > line ? "over" : "under") : "";
    const tr = el("tr");
    tr.innerHTML = `
      <td>${l.season} W${l.week}${l.div_game ? ' <span class="pos-tag">div</span>' : ""}</td>
      <td>${esc(l.opponent)}</td>
      <td>${l.home === true ? "H" : l.home === false ? "A" : "—"}</td>
      <td>${fmt(v, opt.key === "receptions" || opt.key.endsWith("tds") || opt.key === "targets" || opt.key === "carries" ? 0 : 1)}</td>
      <td class="${hit}">${hit ? (hit === "over" ? "▲" : "▼") : ""}</td>`;
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  const log = $("#pc-log");
  log.innerHTML = "";
  log.appendChild(el("div", "loghint", `${n} games match · ▲ over the line, ▼ under.`));
  log.appendChild(tbl);
}

function runWithWithout(game, team, player, logs) {
  const mateId = $("#ww-mate").value;
  const opt = STAT_OPTIONS.find((o) => o.key === $("#ww-stat").value);
  const out = $("#ww-result");
  if (!mateId) {
    out.innerHTML = `<p class="empty">No teammates listed.</p>`;
    return;
  }
  const mateLogs = game.player_logs[mateId] || [];
  const matePlayed = new Set(mateLogs.map((l) => `${l.season}-${l.week}`));

  const withG = [], withoutG = [];
  logs.forEach((l) => {
    (matePlayed.has(`${l.season}-${l.week}`) ? withG : withoutG).push(statVal(opt, l));
  });
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const mateName = game.teams[team].usage.find((p) => p.player_id === mateId)?.name || "teammate";

  out.innerHTML = `
    <div class="loghint">${esc(player.name)}'s ${esc(opt.label.toLowerCase())} per game when ${esc(mateName)} played vs sat (reference window).</div>
    <div class="ww-compare">
      <div class="ww-box"><div class="big">${withG.length ? fmt(avg(withG), 1) : "—"}</div><div class="lbl">With ${esc(mateName)} (${withG.length}g)</div></div>
      <div class="ww-box"><div class="big">${withoutG.length ? fmt(avg(withoutG), 1) : "—"}</div><div class="lbl">Without (${withoutG.length}g)</div></div>
    </div>`;
}

init();

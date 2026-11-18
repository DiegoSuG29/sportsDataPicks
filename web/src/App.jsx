import { useEffect, useState } from "react";
import { getJSON, manifestUrl, dataUrl } from "./api.js";
import Header from "./components/Header.jsx";
import GameList from "./components/GameList.jsx";
import GameTabs from "./components/GameTabs.jsx";
import GameView from "./components/GameView.jsx";
import PlayerModal from "./components/PlayerModal.jsx";

const ACTIONS_URL = "https://github.com/DiegoSuG29/sportsDataPicks/actions";

export default function App() {
  const [manifest, setManifest] = useState(null);
  const [weekFile, setWeekFile] = useState(null);
  const [week, setWeek] = useState(null);
  const [gameFile, setGameFile] = useState(null); // null => list view
  const [game, setGame] = useState(null);
  const [modal, setModal] = useState(null); // { game, team, player }
  const [error, setError] = useState(null);

  // manifest on mount
  useEffect(() => {
    getJSON(manifestUrl())
      .then((m) => {
        setManifest(m);
        if (m.latest) setWeekFile(m.latest.file);
      })
      .catch((e) => setError(e.message));
  }, []);

  // week index when the selected week changes
  useEffect(() => {
    if (!weekFile) return;
    setGameFile(null);
    setGame(null);
    getJSON(dataUrl(weekFile)).then(setWeek).catch((e) => setError(e.message));
  }, [weekFile]);

  // game detail when a game is selected
  useEffect(() => {
    if (!gameFile) {
      setGame(null);
      return;
    }
    setGame(null);
    getJSON(dataUrl(gameFile)).then(setGame).catch((e) => setError(e.message));
  }, [gameFile]);

  const stamp =
    week &&
    `Season ${week.season} · ${week.games.length} games · stats through Week ${week.stats_through_week} · data generated ${new Date(week.generated_at).toLocaleString()}`;

  return (
    <>
      <Header
        weeks={manifest?.weeks || []}
        weekFile={weekFile}
        onWeekChange={setWeekFile}
        actionsUrl={ACTIONS_URL}
      />

      {stamp && <p className="data-stamp">{stamp}</p>}

      <main>
        {error && <p className="empty">Could not load data: {error}</p>}

        {!gameFile && week && (
          <GameList games={week.games} onOpen={setGameFile} />
        )}

        {gameFile && week && (
          <>
            <GameTabs
              games={week.games}
              current={gameFile}
              onSelect={setGameFile}
              onBack={() => setGameFile(null)}
            />
            {game ? (
              <GameView game={game} onPlayer={(team, player) => setModal({ game, team, player })} />
            ) : (
              <p className="empty">Loading game…</p>
            )}
          </>
        )}
      </main>

      {modal && (
        <PlayerModal
          game={modal.game}
          team={modal.team}
          player={modal.player}
          onClose={() => setModal(null)}
        />
      )}

      <footer className="foot">
        <p>No betting sites or picks articles are used as inputs. Reference window: last season + current season only.</p>
      </footer>
    </>
  );
}

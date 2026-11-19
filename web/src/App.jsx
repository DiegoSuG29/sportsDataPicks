import { useEffect, useState } from "react";
import { getJSON, manifestUrl, dataUrl } from "./api.js";
import { SPORTS } from "./sports.js";
import Header from "./components/Header.jsx";
import GameList from "./components/GameList.jsx";
import GameTabs from "./components/GameTabs.jsx";
import GameView from "./components/GameView.jsx";
import PlayerView from "./components/PlayerView.jsx";
import WorstDefenses from "./components/WorstDefenses.jsx";

const ACTIONS_URL = "https://github.com/DiegoSuG29/sportsDataPicks/actions";

export default function App() {
  // ?sport=nba deep-links / bookmarks a sport; default NFL
  const [sport, setSport] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("sport");
    return SPORTS[q] ? q : "nfl";
  });
  const cfg = SPORTS[sport];
  useEffect(() => {
    const url = new URL(window.location.href);
    if (sport === "nfl") url.searchParams.delete("sport");
    else url.searchParams.set("sport", sport);
    window.history.replaceState(null, "", url);
  }, [sport]);
  const [manifest, setManifest] = useState(null);
  const [slateFile, setSlateFile] = useState(null);
  const [slate, setSlate] = useState(null);
  const [gameFile, setGameFile] = useState(null); // null => list view
  const [game, setGame] = useState(null);
  const [playerId, setPlayerId] = useState(null); // non-null => player page
  const [error, setError] = useState(null);

  // Switching sport clears everything in the SAME render batch, so no render
  // ever pairs the new sport's cfg with the old sport's game/player data.
  const changeSport = (s) => {
    setSport(s);
    setManifest(null);
    setSlateFile(null);
    setSlate(null);
    setGameFile(null);
    setGame(null);
    setPlayerId(null);
    setError(null);
  };

  // manifest whenever the sport changes
  useEffect(() => {
    let live = true;
    getJSON(manifestUrl(sport))
      .then((m) => {
        if (!live) return;
        setManifest(m);
        if (m.latest) setSlateFile(m.latest.file);
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [sport]);

  // slate index (NFL week / NBA date) when the selected slate changes
  useEffect(() => {
    setGameFile(null);
    setGame(null);
    if (!slateFile) return;
    let live = true;
    getJSON(dataUrl(sport, slateFile))
      .then((s) => live && setSlate(s))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [slateFile]); // sport is read at call time; a sport change resets slateFile first

  // game detail when a game is selected
  useEffect(() => {
    setPlayerId(null); // leaving/switching a game drops any open player page
    setGame(null);
    if (!gameFile) return;
    let live = true;
    getJSON(dataUrl(sport, gameFile))
      .then((g) => live && setGame(g))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [gameFile]);

  const stamp = slate && cfg.stamp(slate);

  return (
    <>
      <Header
        cfg={cfg}
        sport={sport}
        onSportChange={changeSport}
        slates={manifest?.[cfg.slateListKey] || []}
        slateFile={slateFile}
        onSlateChange={setSlateFile}
        actionsUrl={ACTIONS_URL}
      />

      {stamp && <p className="data-stamp">{stamp}</p>}

      <main>
        {error && <p className="empty">Could not load data: {error}</p>}

        {!gameFile && slate && (
          <>
            <GameList cfg={cfg} games={slate.games} onOpen={setGameFile} />
            {slate.worst_defenses && (
              <WorstDefenses cfg={cfg} data={slate.worst_defenses} onOpen={setGameFile} />
            )}
          </>
        )}

        {gameFile && slate && (
          <>
            <GameTabs
              games={slate.games}
              current={gameFile}
              onSelect={setGameFile}
              onBack={() => setGameFile(null)}
            />
            {!game ? (
              <p className="empty">Loading game…</p>
            ) : playerId ? (
              <PlayerView
                key={playerId}
                cfg={cfg}
                game={game}
                playerId={playerId}
                onSelectPlayer={setPlayerId}
                onBack={() => setPlayerId(null)}
              />
            ) : (
              <GameView cfg={cfg} game={game} onPlayer={(team, player) => setPlayerId(player.player_id)} />
            )}
          </>
        )}
      </main>
    </>
  );
}

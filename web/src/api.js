// Data lives under <base>/data/<sport>. BASE_URL is "/" in dev and
// "/sportsDataPicks/" in the production build, so these resolve same-origin in
// both. (In dev a Vite middleware serves the repo-root data/ folder.)
const base = import.meta.env.BASE_URL;

export async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const manifestUrl = (sport) => `${base}data/${sport}/manifest.json`;
export const dataUrl = (sport, file) => `${base}data/${sport}/${file}`;

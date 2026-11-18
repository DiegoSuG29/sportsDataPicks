// Data lives under <base>/data/nfl. BASE_URL is "/" in dev and
// "/sportsDataPicks/" in the production build, so these resolve same-origin
// in both. (In dev a Vite middleware serves the repo-root data/ folder.)
export const DATA_BASE = `${import.meta.env.BASE_URL}data/nfl`;

export async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const manifestUrl = () => `${DATA_BASE}/manifest.json`;
export const dataUrl = (file) => `${DATA_BASE}/${file}`;

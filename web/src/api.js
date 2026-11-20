// Data lives under <base>/data/<sport>. BASE_URL is "/" in dev and
// "/sportsDataPicks/" in the production build, so these resolve same-origin in
// both. (In dev a Vite middleware serves the repo-root data/ folder.)
const base = import.meta.env.BASE_URL;

export async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return expandTables(await res.json());
}

// The pipelines write bulky row lists as {cols: [...], rows: [[...], ...]}
// (field names once). Expand them back into arrays of row objects, anywhere in
// the document, so components always see plain rows.
function expandTables(v) {
  if (Array.isArray(v)) return v.map(expandTables);
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 2 && Array.isArray(v.cols) && Array.isArray(v.rows)) {
      const { cols, rows } = v;
      return rows.map((r) => {
        const o = {};
        for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i];
        return o;
      });
    }
    for (const k of keys) v[k] = expandTables(v[k]);
  }
  return v;
}

export const manifestUrl = (sport) => `${base}data/${sport}/manifest.json`;
export const dataUrl = (sport, file) => `${base}data/${sport}/${file}`;

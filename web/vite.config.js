import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

// In production the deploy workflow copies repo-root data/ next to the build,
// so the app fetches it same-origin. During `vite dev` that data isn't part of
// the app, so serve it straight from the repo-root data/ folder.
function serveRepoData() {
  return {
    name: "serve-repo-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url || "").split("?")[0]);
        const fp = path.normalize(path.join(DATA_DIR, rel));
        if (fp.startsWith(DATA_DIR) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          res.setHeader("Content-Type", "application/json");
          fs.createReadStream(fp).pipe(res);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Served under the project subpath on GitHub Pages; root in dev.
  base: command === "build" ? "/sportsDataPicks/" : "/",
  plugins: [react(), serveRepoData()],
}));

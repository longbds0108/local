// MapLibre v6 loads its web worker from a URL next to the library file, which
// webpack rewrites. Serve the (self-contained) worker from /public instead.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.css"));
const outDir = join(here, "../public/maplibre");
mkdirSync(outDir, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(outDir, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs → public/maplibre/");

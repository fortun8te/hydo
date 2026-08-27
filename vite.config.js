import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * KaTeX ships every face three times — woff2, woff and ttf — and its CSS lists
 * all three in one `src:`. Vite emits an asset for every url it finds, so the
 * packaged app carried 876 kB of .woff and .ttf that Chromium will never
 * request: it supports woff2 and always picks the first format it understands.
 *
 * Rewriting the declaration before Vite resolves the urls (rather than deleting
 * files afterwards) means the fallbacks are never emitted in the first place,
 * and nothing is left pointing at a missing file. This app only ever runs in
 * Electron's Chromium, so there is no browser left to fall back for.
 */
function katexWoff2Only() {
  return {
    name: "hydo-katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("katex") || !id.endsWith(".css")) return null;
      const out = code.replace(
        /,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g,
        ""
      );
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), katexWoff2Only()],
  base: "./",
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", emptyOutDir: true },
});

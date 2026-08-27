/**
 * bundle-size-test — a ceiling on what the app makes you download before it
 * can paint, asserted against a REAL `vite build` output.
 *
 * This exists because the launch chunk had quietly grown to 776 kB, a third of
 * which was KaTeX (loaded eagerly for a feature most threads never use) and
 * ~64 kB of overlays you may never open. Both are now separate chunks. A
 * ceiling is the only thing that keeps them separate: a single stray static
 * `import` at the top of Shell.jsx silently folds a lazy chunk back into the
 * launch one and nothing else in this suite would notice.
 *
 * Measured at the time of writing: index 482 kB, total assets 1.88 MB.
 * The ceilings are set with ~10% of headroom. If you legitimately need more,
 * raise them deliberately and say why — do not raise them to make a red test
 * green.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist", "assets");

// A stale dist would make this test assert nothing at all, so build first.
execFileSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
  cwd: root,
  stdio: "pipe",
});

const files = fs.readdirSync(dist);
const sizeOf = (f) => fs.statSync(path.join(dist, f)).size;

const entry = files.filter((f) => /^index-.*\.js$/.test(f));
assert.strictEqual(entry.length, 1, "exactly one entry chunk");
const entryKB = Math.round(sizeOf(entry[0]) / 1024);

const MAX_ENTRY_KB = 530;
assert.ok(
  entryKB <= MAX_ENTRY_KB,
  `launch chunk is ${entryKB} kB, ceiling is ${MAX_ENTRY_KB} kB — something eager grew`
);

const totalKB = Math.round(files.reduce((n, f) => n + sizeOf(f), 0) / 1024);
const MAX_TOTAL_KB = 2100;
assert.ok(totalKB <= MAX_TOTAL_KB, `dist/assets is ${totalKB} kB, ceiling is ${MAX_TOTAL_KB} kB`);

// ---- the split has to actually have happened -------------------------------
// Asserting the ceiling alone is not enough: these are the specific chunks
// that were carved out, and a static import anywhere re-merges them without
// changing anything visible.
const chunk = (name) => files.some((f) => f.startsWith(`${name}-`) && f.endsWith(".js"));
for (const name of ["katex", "Settings", "Plugins", "Rollback", "Artifact", "About", "FaceLab"]) {
  assert.ok(chunk(name), `${name} is its own chunk, not part of the launch bundle`);
}
// KaTeX out of the JS but its CSS still inlined in the main stylesheet would
// put 28 kB back on the critical path for nothing.
assert.ok(
  files.some((f) => /^katex-.*\.css$/.test(f)),
  "KaTeX's stylesheet rides with its chunk"
);

// ---- KaTeX's font fallbacks are not shipped --------------------------------
// Chromium takes woff2 and never asks for the .woff/.ttf copies; emitting them
// was 876 kB of an installed app that no code path can ever read.
const strays = files.filter((f) => /^KaTeX_.*\.(woff|ttf)$/.test(f));
assert.deepStrictEqual(strays, [], "no .woff/.ttf KaTeX fonts — woff2 only");
assert.ok(
  files.some((f) => /^KaTeX_.*\.woff2$/.test(f)),
  "the woff2 faces themselves DO ship (offline app, no CDN)"
);

// And nothing may point at a file that is no longer emitted.
const katexCss = fs.readFileSync(path.join(dist, files.find((f) => /^katex-.*\.css$/.test(f))), "utf8");
for (const url of katexCss.match(/url\(([^)]+)\)/g) || []) {
  const ref = url.slice(4, -1).replace(/["']/g, "").replace(/^\.?\//, "");
  if (ref.startsWith("data:")) continue;
  assert.ok(files.includes(path.basename(ref)), `katex css references a missing asset: ${ref}`);
}

console.log(`bundle-size-test ok — entry ${entryKB} kB (max ${MAX_ENTRY_KB}), assets ${totalKB} kB (max ${MAX_TOTAL_KB})`);

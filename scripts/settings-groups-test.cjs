"use strict";

/**
 * The Settings panes are GROUPED — measured in a real BrowserWindow.
 *
 * The pane has been two wrong shapes already: a separate rounded card per row
 * (a pile of objects), and then one single card holding fifteen rows (a wall of
 * text with no map). It is now a small number of labelled groups. Both wrong
 * shapes would pass a source-text assertion, and the difference between them
 * is entirely geometric — so this suite boots Electron, opens the real dialog,
 * and reads getBoundingClientRect.
 *
 * That is not paranoia: this file lost a specificity fight this session
 * (`.hy-dialog button` at (0,1,1) beating `.settings__seg-btn` at (0,1,0)),
 * which no amount of reading the stylesheet would have caught.
 *
 * Three properties, in both themes:
 *   - the group's label sits OUTSIDE its fill (label bottom above group top)
 *   - hairlines are BETWEEN rows, never above the first one (which would draw
 *     a line across the card's own rounded corner)
 *   - the gap between groups is much larger than the gap between rows, so the
 *     grouping is legible as space
 *
 * The build and the Electron run are separate processes ON PURPOSE: running
 * the vite build with execFileSync from inside the Electron main process
 * leaves that process unable to start its network service, and every later
 * page load dies with ERR_FAILED. Measured, twice.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(os.tmpdir(), "hydo-settings-shot-dist");
const PREFIX = path.join(os.tmpdir(), "hydo-settings-groups");

// `import.meta.env.DEV` is not derived from --mode; vite computes it from
// NODE_ENV. Without this the devmock chunk is dropped and the app renders its
// signed-out screen forever, which is a very confusing way to fail.
execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});

const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "settings-shot.cjs"), "general", PREFIX], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
});

const shot = JSON.parse(fs.readFileSync(`${PREFIX}.json`, "utf8"));
assert.deepEqual(Object.keys(shot), ["dark", "light"], "both themes must be photographed");

for (const [theme, page] of Object.entries(shot)) {
  const groups = page.groups.filter((g) => g.rows.length);
  const where = (msg) => `${theme}: ${msg}`;

  // Several groups, but not one per row. Both are real regressions.
  assert.ok(groups.length >= 4, where(`expected at least 4 labelled groups, got ${groups.length}`));
  assert.ok(
    groups.every((g) => g.label),
    where("every group must carry a quiet label of its own")
  );
  const single = groups.filter((g) => g.rows.length === 1).length;
  assert.ok(
    single <= 1,
    where(`${single} groups hold a single row — that is the old card-per-row bug coming back`)
  );

  const labels = groups.map((g) => g.label);
  assert.deepEqual(
    labels,
    ["Account", "Appearance", "Where turns run", "System"],
    where("the General pane's groups, in order")
  );

  for (const g of groups) {
    // The label is outside the fill, not inside it.
    assert.ok(
      g.labelBottom !== null && g.labelBottom <= g.groupTop,
      where(`"${g.label}" label overlaps its own card (${g.labelBottom} > ${g.groupTop})`)
    );
    // The card is a card.
    assert.ok(g.radius >= 8, where(`"${g.label}" lost its rounded fill`));
    // Hairlines: none above the first row, one above every other, each sitting
    // exactly on the boundary it divides.
    assert.equal(g.rows[0].divider, null, where(`"${g.label}" draws a hairline over its own top corner`));
    for (let i = 1; i < g.rows.length; i++) {
      const row = g.rows[i];
      assert.ok(row.divider !== null, where(`"${g.label}" row ${i} has no divider above it`));
      assert.ok(
        Math.abs(row.divider - g.rows[i - 1].bottom) < 1.5,
        where(`"${g.label}" row ${i}'s divider is not on the seam between the rows`)
      );
      // Rows inside a group share an edge — no gap to speak of.
      assert.ok(
        Math.abs(row.top - g.rows[i - 1].bottom) < 1.5,
        where(`"${g.label}" rows are spaced apart; they should be divided by a hairline instead`)
      );
    }
  }

  // Space between groups, and much more of it than between rows.
  for (let i = 1; i < groups.length; i++) {
    const gap = groups[i].groupTop - groups[i - 1].groupBottom;
    assert.ok(
      gap >= 24,
      where(`only ${gap}px between "${groups[i - 1].label}" and "${groups[i].label}" — groups must breathe`)
    );
  }

  // Both themes are real themes, not the same one twice: the hairline colour
  // has to differ, which is the check that caught this script lying once.
  const hair = groups.flatMap((g) => g.rows.map((r) => r.dividerColor)).filter(Boolean);
  assert.ok(hair.length, where("no dividers were drawn at all"));
  page._hair = hair[0];
}
assert.notEqual(
  shot.dark._hair,
  shot.light._hair,
  "dark and light drew the same hairline colour — the theme never actually changed"
);

console.log("settings-groups-test ok");

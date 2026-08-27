"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const botHome = require("../electron/bot-home.cjs");
const gateway = require("../electron/hermes-gateway.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-home-"));
const botId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const home = botHome.prepare(dir, botId, "# soul\n");
assert.ok(home.cwd.startsWith(path.join(dir, "bots", botId)));
assert.ok(!home.cwd.startsWith(os.homedir() + path.sep + "Documents"));
assert.equal(home.cwd, path.resolve(home.cwd));
assert.ok(fs.existsSync(path.join(home.cwd, "AGENTS.md")));
assert.ok(fs.readFileSync(path.join(home.cwd, "AGENTS.md"), "utf8").includes("Never"));
assert.ok(fs.existsSync(path.join(home.cwd, "SHARED.md")));
assert.ok(fs.lstatSync(path.join(home.cwd, "SHARED.md")).isSymbolicLink());
assert.equal(
  fs.realpathSync(path.join(home.cwd, "SHARED.md")),
  fs.realpathSync(path.join(dir, "shared", "MEMORY.md"))
);
assert.match(home.profile, /^hydo[a-z0-9]+$/);
assert.ok(home.hermesHome.includes(path.join(".hermes", "profiles", home.profile)));
assert.notEqual(home.hermesHome, path.join(os.homedir(), ".hermes"));
assert.ok(fs.existsSync(path.join(home.hermesHome, "memories", "MEMORY.md")));
assert.ok(home.memoryFile.endsWith(path.join("memories", "MEMORY.md")));
assert.ok(fs.existsSync(path.join(home.hermesHome, "memories")));
assert.ok(fs.existsSync(path.join(home.hermesHome, "skills")));

botHome.appendSubagentLog(dir, botId, { type: "subagent.start", goal: "search the web" });
const log = fs.readFileSync(path.join(dir, "bots", botId, "logs", "subagents.jsonl"), "utf8");
assert.ok(log.includes("search the web"));

assert.equal(gateway.DEFAULT_PROFILE, "builder");
assert.ok(gateway.TOOL_PROFILES.builder.includes("delegation"));
assert.ok(gateway.TOOL_PROFILES.builder.includes("web"));
assert.ok(gateway.TOOL_PROFILES.builder.includes("file"));
assert.ok(gateway.TOOL_PROFILES.builder.includes("computer_use"));
assert.ok(!gateway.TOOL_PROFILES.builder.includes("vision"));
assert.ok(!gateway.TOOL_PROFILES.writer.includes("computer_use"));
assert.ok(gateway.pinFor({ profile: "builder", mcp: ["cua", "open-computer"] }).includes("computer_use"));
assert.ok(!gateway.pinFor({ profile: "builder", mcp: ["cua"] }).includes("cua"));
assert.ok(!gateway.pinFor({ profile: "builder", mcp: ["open-computer"] }).includes("open-computer"));
assert.ok(!gateway.pinFor({ profile: "builder" }).includes("exa"));
assert.ok(!gateway.pinFor({ profile: "builder" }).includes("parallel-search"));
assert.ok(gateway.pinFor({ profile: "builder", mcp: ["exa"] }).includes("exa"));
assert.equal(
  gateway.pinFor({ profile: "builder" }),
  "clarify,computer_use,delegation,desktop_ui,file,memory,session_search,skills,terminal,todo,web"
);
assert.equal(gateway.pinFor({ profile: "writer" }), "clarify,file,memory,skills,todo");
assert.ok(!gateway.pinFor({ profile: "writer" }).includes("computer_use"));
assert.equal(
  gateway.pinFor({ profile: "builder", mcp: ["exa"] }),
  "clarify,computer_use,delegation,desktop_ui,exa,file,memory,session_search,skills,terminal,todo,web"
);
assert.equal(gateway.isBlockedComputerUseMcp("cua"), true);
{
  const src = fs.readFileSync(path.join(__dirname, "../electron/hermes-gateway.cjs"), "utf8");
  assert.ok(
    src.includes("pin === undefined ? pinFor({ profile: DEFAULT_PROFILE })"),
    "omitted pin must be builder, not Hermes default"
  );
  assert.ok(src.includes("function request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS, pin)"), "request must not default pin to empty");
}
assert.equal(gateway.isBlockedComputerUseMcp("chrome-devtools"), false);

const { activityFromTool } = require("../electron/activity.cjs");
assert.equal(activityFromTool("computer_use"), "On your computer");
assert.equal(activityFromTool("read_file"), "Reading a file");
assert.equal(activityFromTool("mcp__github__create_pull_request"), "Opening a pull request on GitHub");
assert.equal(activityFromTool("browser_exec"), "Browsing");
assert.equal(activityFromTool("terminal", { command: "grok --no-auto-update -p fix it" }), "Connecting to Grok Build");
assert.equal(activityFromTool("bash", { args: ["opencode", "run"] }), "Connecting to OpenCode");
assert.equal(activityFromTool("terminal", { command: "cursor agent -p" }), "Connecting to Cursor");

assert.ok(fs.readFileSync(path.join(home.cwd, "AGENTS.md"), "utf8").includes("computer_use"));

gateway.sessionFor("nope", {}).then(
  () => {
    console.error("sessionFor without cwd must reject");
    process.exit(1);
  },
  (err) => {
    assert.ok(/cwd required/.test(err.message), err.message);
    gateway
      .sessionFor("nope", { cwd: os.homedir() })
      .then(
        () => {
          console.error("homedir cwd must reject");
          process.exit(1);
        },
        (err2) => {
          assert.ok(/homedir/.test(err2.message), err2.message);
          console.log("bot-home-test ok");
        }
      );
  }
);

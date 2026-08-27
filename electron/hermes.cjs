const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { activityFromLine } = require("./activity.cjs");

const DEFAULT_TIMEOUT_MS = 180000;
const TOOLSETS = "web,browser,hermes-cli";
const LOCAL_HERMES = path.join(os.homedir(), ".local", "bin", "hermes");

function pathDirs() {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".hermes", "bin"),
    path.join(home, ".hermes", "node", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function childEnv() {
  const existing = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const seen = new Set(existing);
  const prefix = [];
  for (const dir of pathDirs()) {
    if (!seen.has(dir)) {
      prefix.push(dir);
      seen.add(dir);
    }
  }
  return { ...process.env, PATH: prefix.concat(existing).join(path.delimiter) };
}

function isExecFile(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveHermesBin() {
  if (isExecFile(LOCAL_HERMES)) return LOCAL_HERMES;
  const env = childEnv();
  for (const dir of env.PATH.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "hermes");
    if (isExecFile(candidate)) return candidate;
  }
  return null;
}

function hermesAvailable() {
  return !!resolveHermesBin();
}

function buildPrompt(system, user) {
  const s = String(system || "").trim();
  const u = String(user || "").trim();
  if (s && u) return `${s}\n\n${u}`;
  return u || s;
}

function writeWorkspace(cwd, system) {
  if (!cwd) return;
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), String(system || "").trim() + "\n");
}

function finalText(raw) {
  const lines = String(raw || "").trim().split("\n");
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (/^(session[_ ]?id|session:|id:|cwd:)/i.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

function buildArgv({ user, sessionName, cwd }) {
  if (sessionName && cwd) {
    return [
      "chat",
      "-q",
      user,
      "-Q",
      "--yolo",
      "-t",
      TOOLSETS,
      "--continue",
      sessionName,
      "--create-if-missing",
      "--in",
      cwd,
    ];
  }
  return ["-z", user, "-t", TOOLSETS, "--yolo"];
}

function emitActivity(line, onActivity, lastRef) {
  if (typeof onActivity !== "function") return;
  const label = activityFromLine(line);
  if (!label || label === lastRef.value) return;
  lastRef.value = label;
  try {
    onActivity(label);
  } catch {
    /* caller callback must not fail the run */
  }
}

function attachLines(stream, onLine) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  });
  stream.on("end", () => {
    if (buf) onLine(buf);
  });
}

function followLog(file, onLine) {
  // -z redirects stdio to /dev/null; tool lines still land in agent.log.
  let pos = 0;
  try {
    pos = fs.statSync(file).size;
  } catch {
    return () => {};
  }
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return () => {};
  }
  let carry = "";
  const timer = setInterval(() => {
    try {
      const size = fs.fstatSync(fd).size;
      if (size < pos) pos = 0;
      if (size <= pos) return;
      const len = size - pos;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      pos = size;
      carry += buf.toString("utf8");
      const parts = carry.split("\n");
      carry = parts.pop() || "";
      for (const line of parts) onLine(line);
    } catch {
      /* log vanished or rotated */
    }
  }, 200);
  timer.unref();
  return () => {
    clearInterval(timer);
    if (carry) onLine(carry);
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  };
}

function killChild(child) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 2000).unref();
}

async function hermesComplete({ system, user, onActivity, timeoutMs, sessionName, cwd } = {}) {
  const bin = resolveHermesBin();
  if (!bin) throw new Error("hermes binary not found");
  writeWorkspace(cwd, system);
  const prompt = cwd ? String(user || "").trim() : buildPrompt(system, user);
  const ms = timeoutMs == null ? DEFAULT_TIMEOUT_MS : timeoutMs;
  const argv = buildArgv({ user: prompt, sessionName, cwd });
  const lastRef = { value: null };
  const onLine = (line) => emitActivity(line, onActivity, lastRef);
  const logFile = path.join(process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"), "logs", "agent.log");

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const stdoutChunks = [];
    const stderrChunks = [];

    const stopLog = followLog(logFile, onLine);
    const child = spawn(bin, argv, {
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function settle(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopLog();
      fn();
    }

    const timer =
      ms > 0
        ? setTimeout(() => {
            timedOut = true;
            killChild(child);
          }, ms)
        : null;
    if (timer) timer.unref();

    attachLines(child.stdout, (line) => {
      stdoutChunks.push(line, "\n");
      onLine(line);
    });
    attachLines(child.stderr, (line) => {
      stderrChunks.push(line, "\n");
      onLine(line);
    });

    child.on("error", (err) => {
      settle(() => {
        if (err && err.code === "ENOENT") {
          reject(new Error(`hermes binary not found: ${bin}`));
          return;
        }
        reject(err);
      });
    });

    child.on("close", (code, signal) => {
      settle(() => {
        const text = stdoutChunks.join("").trim();
        const errText = stderrChunks.join("").trim();
        if (timedOut) {
          reject(new Error(`hermes timed out after ${ms}ms`));
          return;
        }
        if (code !== 0 && !text) {
          reject(
            new Error(
              errText ||
                (signal ? `hermes killed (${signal})` : `hermes exited ${code}`)
            )
          );
          return;
        }
        if (!text) {
          reject(new Error(errText || "hermes produced no final response"));
          return;
        }
        resolve(finalText(text));
      });
    });
  });
}

module.exports = { hermesComplete, hermesAvailable };

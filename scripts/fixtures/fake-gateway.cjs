#!/usr/bin/env node
"use strict";

/**
 * A stand-in for Hermes' tui_gateway, speaking the same newline-delimited
 * JSON-RPC over stdio. It exists so the orphan/close behaviour in
 * electron/hermes-gateway.cjs can be tested without a real Hermes install --
 * npm test does not (and should not) require live Hermes.
 *
 * Behaviour is driven by env so one fixture serves every case:
 *   FAKE_SLOW_CREATE_MS  delay before answering the FIRST session.create, so
 *                        the client's own timeout fires first and the reply
 *                        lands as an abandoned one.
 *   FAKE_SLOW_CLOSE_MS   delay before answering session.close.
 *   FAKE_TRACE           file to append one JSON line per received request.
 */

const fs = require("node:fs");
const readline = require("node:readline");

const SLOW_CREATE_MS = Number(process.env.FAKE_SLOW_CREATE_MS || 0);
const SLOW_CLOSE_MS = Number(process.env.FAKE_SLOW_CLOSE_MS || 0);
const TRACE = process.env.FAKE_TRACE || "";

let sessions = 0;
let firstCreate = true;

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const trace = (row) => {
  if (!TRACE) return;
  try {
    fs.appendFileSync(TRACE, `${JSON.stringify({ ...row, at: Date.now() })}\n`);
  } catch {
    /* tracing is never load-bearing */
  }
};

send({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } });

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || msg.id == null) return;
  const reply = (result, delay = 0) => {
    const fire = () => send({ jsonrpc: "2.0", id: msg.id, result });
    if (delay > 0) setTimeout(fire, delay).unref?.();
    else fire();
  };

  if (msg.method === "session.create") {
    const id = `sess-${++sessions}`;
    trace({ method: msg.method, id: msg.id, session_id: id });
    const slow = firstCreate ? SLOW_CREATE_MS : 0;
    firstCreate = false;
    reply({ session_id: id, stored_session_id: id, info: {} }, slow);
    return;
  }
  if (msg.method === "session.resume") {
    const key = msg.params && msg.params.session_id;
    trace({ method: msg.method, id: msg.id, session_id: key });
    // Checked per-request via a FILE, not an env var: the child is spawned
    // once per tool profile and long-lived, so an env var set by the test
    // after that spawn never reaches it -- which silently turned this into a
    // test of the happy path.
    if (process.env.FAKE_RESUME_FAIL_FLAG && fs.existsSync(process.env.FAKE_RESUME_FAIL_FLAG)) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: 4004, message: "no such session" } });
      return;
    }
    // A resumed session keeps its STORED key and gets a fresh live id -- the
    // same split the real gateway reports.
    reply({ session_id: `sess-resumed-${++sessions}`, stored_session_id: key, info: {} });
    return;
  }
  if (msg.method === "session.close") {
    const sid = msg.params && msg.params.session_id;
    trace({ method: msg.method, id: msg.id, session_id: sid });
    const fire = () => {
      // Traced separately from receipt: the client is only allowed to build
      // the replacement session after the close has been ANSWERED, and
      // "answered" is a different moment from "received".
      trace({ method: "session.close.done", id: msg.id, session_id: sid });
      send({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
    };
    if (SLOW_CLOSE_MS > 0) setTimeout(fire, SLOW_CLOSE_MS).unref?.();
    else fire();
    return;
  }
  if (msg.method === "prompt.background" || msg.method === "prompt.submit") {
    const sid = msg.params && msg.params.session_id;
    const text = (msg.params && msg.params.text) || "";
    trace({ method: msg.method, id: msg.id, session_id: sid, text });
    reply({ ok: true });
    // The completion arrives later, as an EVENT -- which is what makes the
    // routing bug observable: a second background job overwrites the first,
    // and the first job's completion then settles the second one.
    const delay = Number(process.env.FAKE_BG_COMPLETE_MS || 300);
    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        method: "event",
        params: {
          session_id: sid,
          type: msg.method === "prompt.background" ? "background.complete" : "message.complete",
          payload: { text: `done:${text}`, status: "complete" },
        },
      });
    }, delay).unref?.();
    return;
  }
  trace({ method: msg.method, id: msg.id });
  reply({ ok: true });
});

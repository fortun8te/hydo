"use strict";

// Hermes' dangerous-command / tool-approval gate is the single biggest thing
// standing between a teammate and something the user did not expect. Every
// other capability in this app was found broken at least once by looking
// closely (see docs/HERMES-GAPS.md) — this test exists so the approval path
// specifically stays wired: event in, card up, answer out, fail closed.
//
// This is a source-shape test (like steer-test.cjs), not a live-gateway run:
// it asserts the plumbing exists and has not regressed, not that Hermes
// itself behaves — that half is read-only-verified in docs/SAFETY.md against
// the installed ~/.hermes/hermes-agent.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const gw = fs.readFileSync(path.join(__dirname, "../electron/hermes-gateway.cjs"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "../electron/preload.cjs"), "utf8");

// ---- the gateway dispatches approval.request to a handler, not a black hole
const dispatchIdx = gw.indexOf("case 'approval.request':");
assert.ok(dispatchIdx > 0, "approval.request is handled in the event switch");
const dispatchBlock = gw.slice(dispatchIdx, dispatchIdx + 400);
assert.ok(/onApproval/.test(dispatchBlock), "approval.request is forwarded to onApproval");

// ---- the choice set matches tools/approval.py's _ApprovalEntry.result
// (once/session/always/deny) and an unrecognized choice falls to deny, not
// through — an unknown string reaching the RPC as the literal choice would
// either error the RPC or (worse) be interpreted permissively server-side.
assert.ok(
  /APPROVAL_CHOICES = \['once', 'session', 'always', 'deny'\]/.test(gw),
  "the four Hermes-understood approval choices are named explicitly"
);
const respondIdx = gw.indexOf("function respondApproval(");
assert.ok(respondIdx > 0, "respondApproval exists");
const respondBlock = gw.slice(respondIdx, respondIdx + 800);
assert.ok(
  /APPROVAL_CHOICES\.includes\(choice\) \? choice : 'deny'/.test(respondBlock),
  "an unrecognized choice fails closed to deny, never passed through raw"
);
// `all` must default to false, not truthy-by-accident: bulk-resolving every
// pending approval on a session is a real bulk action and must be opt-in.
assert.ok(/all: !!opts\.all/.test(respondBlock), "bulk-resolve is explicit opt-in, coerced to a real boolean");
// session_id scopes the RPC to the ONE bot answering — approval.respond on
// the Hermes side resolves against that session_key only, so this call must
// carry it or a bulk answer could (mechanically, on the Hermes side) reach
// past the bot the user is looking at.
assert.ok(/session_id: bot\.sessionId/.test(respondBlock), "the respond RPC is scoped to the answering bot's session");

// ---- the store turns the event into a real card, not a swallowed callback
const onApprovalIdx = src.indexOf("onApproval: (req)");
assert.ok(onApprovalIdx > 0, "store wires onApproval");
const onApprovalBlock = src.slice(onApprovalIdx, onApprovalIdx + 600);
assert.ok(/kind: "approval"/.test(onApprovalBlock), "an approval request becomes an 'approval' card");
assert.ok(/requestId: req\.request_id/.test(onApprovalBlock), "the card carries the request_id needed to answer it");
assert.ok(/if \(!req \|\| !req\.request_id\) return;/.test(onApprovalBlock), "a malformed event without a request_id is dropped, not carded as unanswerable");

// ---- answering routes back through the gateway and can't double-fire
const answerIdx = src.indexOf("async answerApproval(messageId, choice)");
assert.ok(answerIdx > 0, "store exposes answerApproval");
const answerBlock = src.slice(answerIdx, answerIdx + 800);
assert.ok(/msg\.kind !== "approval" \|\| msg\.answered/.test(answerBlock), "an already-answered or non-approval card cannot be answered again");
assert.ok(/gateway\.respondApproval\(msg\.fromId, msg\.requestId, msg\.answered\)/.test(answerBlock), "the answer is sent to the bot that actually asked, not the selected bot");

// ---- the renderer can actually reach it — this is the exact shape of bug
// this project keeps finding: a preload method with no caller (session.steer
// before it was wired; learning.frames still in that state).
assert.ok(/answerApproval: \(messageId, choice\) => ipcRenderer\.invoke\("hydo:answerApproval"/.test(preload), "answerApproval is exposed on the preload bridge");
const uiSrc = fs.readFileSync(path.join(__dirname, "../src/screens/Transcript.jsx"), "utf8");
assert.ok(/window\.hydo\?\.answerApproval\?\.\(msg\.id, choice\)/.test(uiSrc), "the transcript UI actually calls it — the bridge has a caller");

console.log("approval-test ok");

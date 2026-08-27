# Safety and auto-permissions: what actually stands between a teammate and you

A Hydo teammate can run shell commands, edit files, drive a desktop/browser,
and (when `computer_use`/box is enabled) act on a shared cloud Linux machine.
This file is about the ONE thing that governs whether it asks first: Hermes'
approval system in `~/.hermes/hermes-agent`, and whether Hydo actually wires
it correctly per bot.

Everything below is marked as either **read** (I read the source and traced
the call graph) or **verified** (I ran `node scripts/approval-test.cjs`, or
read a passing test in `~/.hermes/hermes-agent/tests/`, to confirm the code
does what it looks like it does). Nothing here was checked by starting a real
Hydo bot and having it try something destructive — that would need a live
Hermes account and was out of scope for a read-and-wire pass. Where I say
"should" instead of "does", that is the boundary.

---

## The short version

Hermes' approval gate is real, fail-closed by design, and — unlike several
other Hermes surfaces this project has found (`session.events.since`,
`mcp_servers`, `learning.frames`; see `docs/HERMES-GAPS.md`) — it is **wired
correctly per profile today**. Hydo does not weaken it anywhere. The gaps are
about *visibility*, not about a hole a teammate can walk through unnoticed.

What a teammate CANNOT do, by default, without you seeing a card and clicking
something: run a genuinely dangerous shell command, or perform a mutating
desktop action (click/type/drag/key) via `computer_use`.

What a teammate CAN do without asking, today, and would surprise a user who
has not read this file: run anything the "smart" auto-approver's guard LLM
judges as low-risk — which is most ordinary shell commands (`git`, package
installs, `curl`, scripts) — with no card shown at all. That is Hermes' own
default (`approvals.mode: smart`), not something Hydo turned on.

---

## 1. The gate itself (read, in `~/.hermes/hermes-agent`)

`tools/approval.py` is the single source of truth. Three independent layers,
narrowest to widest:

- **Hardline blocklist** (`HARDLINE_PATTERNS`, `tools/approval.py:515`) —
  `rm -rf /`, recursive delete of system dirs or `$HOME`, and similar. These
  are refused outright; nothing (not even `approvals.mode: off` or the
  session `/yolo` toggle) reaches this floor. Confirmed by reading
  `is_approval_bypass_active_for_session` (`tools/approval.py:3418`), which is
  checked separately from — and does not gate — the hardline detector.
- **Dangerous-pattern detection** (`DANGEROUS_PATTERNS`,
  `detect_dangerous_command`, `tools/approval.py:2505`) — a broader regex set
  (`sudo`, disk tools, `chmod -R`, etc.) that triggers the approval flow
  below rather than an outright block.
- **`approvals.mode`** (`manual` / `smart` / `off`, default `smart` —
  `hermes_cli/config_defaults.py:2440`) governs everything that is NOT
  hardline-blocked:
  - `manual` — every flagged command waits for a human answer.
  - `smart` — a cheap auxiliary LLM (`_smart_approve`,
    `tools/approval.py:3527`) judges the command from a redacted, injection-
    resistant prompt (shell comments stripped, command wrapped in an
    untrusted-input tag) and returns approve / deny / escalate. `escalate`
    and any LLM failure fall through to the human prompt — read at
    `tools/approval.py:3527-3607`, it fails closed, not open.
  - `off` — no prompts at all (this is Hermes' own yolo-equivalent config
    knob; Hydo never sets it).
- **`computer_use`** has its own, narrower version of the same idea
  (`tools/computer_use/tool.py:78-90`): reads (`capture`, `list_windows`, …)
  are always allowed; mutating input actions (`click`, `type`, `key`, `drag`,
  browser automation actions) are in `_DESTRUCTIVE_ACTIONS` and gated at
  `tools/computer_use/tool.py:587`. A fixed set of OS-level key combos
  (empty-trash, force-logout, lock-screen, `ctrl-alt-delete`) is
  hard-blocked regardless of approval level (`_BLOCKED_KEY_COMBOS`,
  `tools/computer_use/tool.py:93`), including hyphen-separated notation —
  the canonicalizer explicitly closes that bypass.

The terminal tool (`tools/terminal_tool.py:358`) imports and calls into
`tools.approval` directly, so every `terminal`-toolset shell command —
including `box exec` on the shared Linux machine (see `docs/BOX.md`) —
goes through the same gate. This is the same mechanism, not a second one.

## 2. Is the gate actually scoped to the right bot's profile? (read)

This matters because it is exactly the class of bug this project keeps
finding: a config lookup that reads the *launch* home instead of the
per-bot profile home at `~/.hermes/profiles/hydo<id>/`. `approvals.mode`
lives in each profile's own `config.yaml`, resolved through
`get_hermes_home()` (`hermes_constants.py:114`), which prefers a
context-local override over the `HERMES_HOME` env var.

Traced where that override gets set for a live turn: `tui_gateway/server.py`
binds `set_hermes_home_override(profile_home)` right before running the
turn (`server.py:11488`) and resets it in the turn's `finally`
(`server.py:12217`). That window covers the entire turn, including every
tool call inside it — so a dangerous-command check that runs mid-turn reads
the *bot's own* `config.yaml`, not the launch home's. This is the pattern
`learning.frames` got wrong (per `docs/HERMES-GAPS.md`, it reads
`get_hermes_home()` from a context where no override is bound); approval
resolution is not making that mistake.

`approval.respond` itself resolves `session["session_key"]` server-side
(`tui_gateway/methods_prompt.py:1665`), and Hydo's `respondApproval`
(`electron/hermes-gateway.cjs:1156`) always sends `session_id: bot.sessionId`
— so even the bulk `all: true` resolve-everything-pending option only
touches the ONE bot's pending approvals, never another bot's queue. This
is asserted in `scripts/approval-test.cjs`.

## 3. What Hydo wires, and how I know (verified via `scripts/approval-test.cjs`)

- `electron/hermes-gateway.cjs` dispatches the `approval.request` event to
  `turn.handlers.onApproval` (`hermes-gateway.cjs:421`).
- `electron/store.cjs`'s `onApproval` handler (`store.cjs:2041`) turns it
  into a real chat card: `kind: "approval"`, carrying `requestId`,
  `command`, `description`, `choices`. A malformed event with no
  `request_id` is dropped rather than carded as something the user can
  never resolve.
- `store.answerApproval` (`store.cjs:3435`) refuses to re-answer an
  already-answered or non-approval message, then calls
  `gateway.respondApproval(msg.fromId, ...)` — note `fromId`, the bot that
  actually asked, not whichever bot happens to be selected in the UI at
  that moment.
- `hermes-gateway.respondApproval` (`hermes-gateway.cjs:1156`) validates the
  choice against Hermes' own vocabulary (`once`/`session`/`always`/`deny`)
  and **falls back to `deny`** for anything unrecognized — an unknown string
  never reaches the RPC as a literal, unvetted choice.
  `electron/preload.cjs` exposes `answerApproval` on the IPC bridge, and
  `src/screens/Transcript.jsx:833` is the actual caller — so this is not the
  "preload method called from nowhere" pattern that `session.steer` and
  `learning.frames` fell into; there is a real path from click to RPC.

This chain had **zero test coverage** before this pass — every other wired
capability in the gaps doc got broken silently at least once because nothing
asserted the shape kept holding. `scripts/approval-test.cjs` now pins: the
event dispatch, the four-choice vocabulary and its deny-on-unknown fallback,
the bulk-resolve opt-in being a real boolean, the session scoping, the card
shape, the re-answer guard, and the preload→UI caller chain. Run via
`npm test` (registered in `package.json`).

## 4. What is missing — visibility, not a hole

Nothing found here makes Hydo *more* permissive than Hermes' own default.
These are gaps in what the user can see or decide, which is a product
decision, not a bug fix:

- **No UI to see or change `approvals.mode` per bot.** Every Hydo profile
  silently inherits Hermes' own default (`smart`). There is no screen where
  a user can see "this teammate auto-approves low-risk shell commands" or
  drop a specific bot to `manual`. `config.set` already exists as an RPC and
  (per the profile-home tracing above) would apply per-bot correctly if
  wired — this is a real, low-risk, well-scoped addition for later, not
  something I chose to build without a product call on default UX.
- **No UI to see or revoke the permanent allowlist.** Answering "always" on
  an approval calls `approve_permanent` (`tools/approval.py:2998`), which
  persists a pattern to the bot's own `config.yaml` (same profile-home
  tracing as above applies) via `save_permanent_allowlist`
  (`tools/approval.py:3139`). Once a user clicks "always" on a bot, that
  bot silently skips the prompt for matching commands forever, and there is
  no screen listing what has accumulated there or a way to clear it short
  of editing the profile's `config.yaml` by hand.
- **`smart` mode is a real, if narrow, trust boundary on an LLM judging an
  LLM.** It has documented defenses (comment-stripping, an untrusted-input
  delimiter, ignore-embedded-instructions framing) but it is still one model
  approving another model's command with no human in the loop for anything
  it doesn't flag. Worth surfacing to the user in plain language rather than
  leaving it as an inherited default nobody chose.

## 5. What I deliberately did not touch

- Did not add any UI or RPC call to change `approvals.mode`, expose the
  allowlist, or otherwise touch permission *policy* — that is exactly the
  "how aggressive should auto-approval be" product decision the task says
  to write up, not choose.
- Did not touch `electron/box-runtime.cjs` or `electron/main.cjs` (excluded).
- Did not weaken or extend `TOOL_PROFILES` / `pinFor` in
  `electron/hermes-gateway.cjs` — `builder` (Hydo's default) already includes
  `terminal` and `computer_use`, both of which route through the gate traced
  above. This file documents that, it does not change it.

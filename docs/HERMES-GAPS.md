# Hermes surface Hydo does not use, and why

Hermes exposes 169 `@method` handlers (`~/.hermes/hermes-agent/tui_gateway/`,
grep for `@method(`); Hydo calls about 50 of them (grep for method-name string
literals across `electron/*.cjs`). Most of the rest are genuinely irrelevant to
a teammate app. This file records the ones that are NOT — either because they
are worth wiring, or because they look worth wiring and are not, which is the
more expensive mistake.

Verified against the installed Hermes at `~/.hermes/hermes-agent` and against
the current Hydo tree, not against documentation. Re-derived 2026-08-27; the
previous pass of this file is superseded — several "worth wiring" items below
have since shipped, and the `vision` entry it carried was flat wrong (see the
note at the bottom).

---

## Fixed (was dead, now wired) — confirmed still true

Traced end to end again this pass: `hermes-gateway.cjs` function ->
`store.cjs`/`main.cjs` IPC handler -> `preload.cjs` exposure -> an actual
renderer caller. All four still have a live caller, not just a definition:

| What | Caller chain |
|---|---|
| `session.events.since` | event stream watermark fix, unchanged |
| `mcp_servers` (per-bot MCP pins) | unchanged |
| `delegation.model` | unchanged |
| `session.steer` | `store.cjs:3165` (auto-steer on delegation) and `store.cjs:3878` (`steerSubagent`, called from the renderer) |

Also reconfirmed as real, not just defined-and-orphaned (the project's
recurring bug shape — a preload method with a comment and no caller):

- **`process.list` / `process.kill`** — `hermes-gateway.cjs:1253/1264`
  (`listProcesses`/`killProcess`) -> `main.cjs:605-611` IPC handlers
  (`hydo:processes`, `hydo:killProcess`) -> `preload.cjs:104-105` -> called
  from `src/screens/BotRail.jsx:204` (list, on rail render) and `:644` (kill
  button). `process.stop` (the unscoped `kill_all()`) is deliberately NOT
  exposed — one shared gateway serves several bots, and it has no session
  scope, so it would reap another bot's process. Comment in
  `hermes-gateway.cjs:1247-1251` documents the reason; still correct.
- **`session.undo`** — `hermes-gateway.cjs:1290` (`undoTurn`) ->
  `store.cjs:2960-2967` (`undoLast`) -> `preload.cjs:103` -> `BotRail.jsx:687`
  (Undo button). Live UI action, not a dead wire.
- **`subagent.interrupt` / `subagent.steer`** — `store.cjs:3822-3879`, called
  from the renderer's steer/interrupt controls.

---

## Do NOT wire: `learning.frames` / `.detail` / `.edit` / `.delete`

Unchanged from the previous pass. Still in `preload.cjs`, still called from
nowhere, still the same bug: `agent/learning_graph.py` builds from
`get_hermes_home() / "memories"`, a **process-level** lookup, and Hydo's
gateway child is never given `HERMES_HOME` — the per-bot profile only binds
the session's agent, not the gateway process the RPC actually runs against.
Wiring it needs a `profile` param on the RPC (a Hermes-side change); `skills.manage`
and `mcp.servers.*` already take one, so there's precedent, but it isn't there
yet for `learning.*`.

---

## New this pass: `image.generate` and most of `pet.*` have the SAME trap

Not in the old file — found by checking every RPC's Python body for
`get_hermes_home()` / config reads, the way `learning.*` and `mcp_servers`
were checked last time.

- **`image.generate`** (`tui_gateway/methods_images.py:22`) takes no `profile`
  or `session_id` param at all. Availability and backend selection go through
  `check_image_generation_requirements()` ->
  `_read_configured_image_provider()`, which reads config off whatever home
  the *gateway process* is running under — the launch profile, not the
  calling bot's. A teammate with no image backend configured on its own
  profile would silently generate through the launch account's key (or vice
  versa: a bot that DOES have one configured would report `available: false`
  because the launch profile doesn't). This is a config leak, not a data
  leak like `learning.frames`, but it is the same shape of bug and the RPC
  gives no way to scope it. Do not wire until it takes a `profile` param.
- **`pet.info` / `.info.meta` / `.cells` / `.gallery` / `.select` / `.remove`
  / `.export` / `.rename` / `.thumb` / `.disable` / `.scale`** — all nine
  carry a `@_profile_scoped` decorator (`tui_gateway/methods_session.py`,
  confirmed by grep) and correctly resolve against the calling profile. These
  ARE safe to build a UI on.
- **`pet.cancel` / `.generate.status` / `.generate` / `.hatch`** — the four
  methods that actually do generation are NOT decorated with
  `@_profile_scoped`. `pet.generate.status` and `pet.generate` resolve the
  image backend the same way `image.generate` does
  (`agent/pet/generate/imagegen.py:resolve_provider`) — same launch-home
  read. So the pet *gallery* (list/rename/export/etc.) is profile-correct,
  but the pet *generator* (make a new one) has the identical trap as
  `image.generate`. A "give this teammate an avatar" feature built on the
  full `pet.*` surface would work for browsing an existing pet and silently
  misattribute a new one to the wrong account's image backend.

---

## Worth wiring, in rough order of value (unchanged items re-verified, new ones added)

- **`tools.show`** — session-bound (`_sessions.get(session_id)`, no separate
  profile param needed since the session already carries it), and still
  unused. `tools.list` (used) gives the toolset catalog; `tools.show` gives
  the actual assembled tool inventory for a live session, i.e. what a
  teammate can call THIS turn, not just what its profile requests. Small,
  session-safe, currently the best true gap.
- **`session.branch`** — re-checked: `methods_session.py:3111` explicitly
  writes into "the parent's profile-scoped state.db", with a comment warning
  against using the launch handle. Profile-safe. "Try it another way" without
  losing the thread — still unwired, still a real feature (not small: needs
  new session/UI plumbing to hold a second live branch).
- **`skills.manage`** — re-confirmed it takes an explicit `profile` param for
  `list`/`install` specifically because "capability UIs manage a bot's skills
  from the main window" (comment in `methods_tools.py:1832`). Hydo's own
  skill authoring (`SKILL:`) is local-only; this would let a teammate browse
  and install from the shared hub. Still unwired.
- **`session.active_list` / `session.most_recent`** — cheap session discovery
  RPCs, unused. Marginal: Hydo already tracks one session per bot itself, so
  the value is mostly resilience (recovering state after a gateway restart)
  rather than a new capability.
- **`pet.*` gallery half** (see trap note above) — building "teammate has an
  avatar" UI on the nine `@_profile_scoped` methods only (skip
  `generate`/`hatch`/`cancel`/`generate.status`) would be profile-safe but
  would mean shipping browse/rename/export with no way to create one, which
  is a strange product to ship. Treat as blocked on the same fix `image.generate`
  needs.

## Not wired this pass, and why: no small win found

Checked for a small-safe-valuable candidate to actually wire (per task
instructions) before writing this up. `tools.show` is the only genuinely
small, profile-safe, unused RPC, but wiring it usefully means new UI (a
per-turn tool inventory view) rather than a one-line fix — not "small" in the
sense the earlier `session.steer`/`mcp_servers` fixes were (those were
one-line bugs in already-built features). Recorded here instead of forced
into the tree as a token change.

## Corrected: attached images DO reach the teammate

Unchanged from the previous pass — re-read, not re-run. The `vision` TOOLSET
(tools) and an attached image (prompt content) are different paths;
`image.attach_bytes` queues bytes that `prompt.submit` turns into vision
tiles regardless of toolset. Hydo's `Composer.jsx` -> `store.cjs:1686`
(`gateway.attachImageBytes`) -> `main.cjs:567` chain is live. Still read, not
run: no live turn with an image was sent from Hydo this pass either to watch
the model describe it.
